"""Redis-backed cache for a paused ai-command execution chain.

POST /images/{id}/ai-command (app/api/v1/routers/ai_command.py) parses a
natural-language command into an ordered chain of steps and executes them in
order. When a step's mask needs human confirmation (mask_service.resolve_mask
returns needs_confirmation -- the segmenter has no no-match signal, so the
user is the only reliable judge of a hit vs. a hallucination), the router
used to raise a 422 and persist nothing. The client's next request re-planned
the whole command from scratch via parse_ai_command_steps and re-executed
every already-paid-for step before the one that stopped -- double-charging
Remove.bg / flux-fill calls -- and the approved mask, bound to a POSITION in
a plan that is regenerated per request, could land on a different operation
entirely (or loop forever) if the replan came back reordered or shorter.

This module is the fix's storage half: a snapshot of exactly where the chain
stopped, keyed by a single-use, unguessable resume token
(secrets.token_urlsafe(32)) rather than anything derivable from the request,
so a resume cannot be forged without the token the server just handed back.
ai_command.py is the only intended caller: store on stopping, load + verify
+ delete on resuming. The steps list travels inside the snapshot itself and
is used VERBATIM on resume -- parse_ai_command_steps must never be called
again for a chain that already has money spent on it.

Redis access follows the pattern already used by product3d.py / backlinks.py
for job enqueue: arq.create_pool(settings.REDIS_SETTINGS) opened and closed
per call, rather than a long-lived pool, since this router has no
app-lifespan-managed pool to reuse. The pool arq.create_pool returns is a
plain redis.asyncio client under the hood, so set(..., ex=...) / get /
delete work exactly as documented for redis-py.
"""
import json
import secrets
from dataclasses import dataclass
from typing import Optional

import arq

from app.core.config import settings

# All resume tokens live under one prefix so they are easy to find/flush in
# Redis tooling without colliding with arq's own job-queue keys.
_KEY_PREFIX = "ai_command_resume:"

# Long enough for a user to look at the highlighted mask and click confirm,
# short enough that an abandoned confirmation does not pin a stale
# intermediate image URL in Redis indefinitely.
_TTL_SECONDS = 30 * 60


@dataclass
class ChainSnapshot:
    """Everything needed to resume a chain without re-planning it or
    re-running steps that already ran (and, for mask/generation steps,
    already cost money).

    steps: the parsed plan, stored verbatim -- resuming must use these
        exact steps, never a fresh call to parse_ai_command_steps.
    current_url: the image as of the end of the last COMPLETED step (i.e.
        the input the stopped step was about to run against).
    applied: operation names already executed, in order -- carried through
        untouched so the final GeneratedImage.edit_operation stays accurate
        even though this request only runs the remaining steps.
    step_index: position in `steps` to resume FROM -- the step that stopped.
    mask_step_index: the mask-queue pointer (see ai_command._next_step_mask)
        at the point execution stopped. This counts mask-requiring steps
        only, so it is generally NOT the same number as step_index.
    mask_queue: the full ordered mask queue in effect when execution
        stopped, including entries for steps beyond the one that stopped --
        a client can front-load masks for a multi-confirmation chain in one
        mask_urls list. Positions before mask_step_index belong to
        already-applied steps and are never read again; they are kept only
        so later positions stay index-aligned.
    org_id / image_id: stringified identity the resume request must match.
        Without this check, org A could resume org B's chain (if it ever
        obtained or guessed org B's token) and read org B's intermediate,
        possibly-not-yet-visible image URLs.
    """
    steps: list[dict]
    current_url: str
    applied: list[str]
    step_index: int
    mask_step_index: int
    mask_queue: list[Optional[str]]
    org_id: str
    image_id: str

    def to_json(self) -> str:
        return json.dumps({
            "steps": self.steps,
            "current_url": self.current_url,
            "applied": self.applied,
            "step_index": self.step_index,
            "mask_step_index": self.mask_step_index,
            "mask_queue": self.mask_queue,
            "org_id": self.org_id,
            "image_id": self.image_id,
        })

    @classmethod
    def from_json(cls, raw: str) -> "ChainSnapshot":
        data = json.loads(raw)
        return cls(
            steps=data["steps"],
            current_url=data["current_url"],
            applied=data["applied"],
            step_index=data["step_index"],
            mask_step_index=data["mask_step_index"],
            mask_queue=data["mask_queue"],
            org_id=data["org_id"],
            image_id=data["image_id"],
        )


async def _redis_pool():
    return await arq.create_pool(settings.REDIS_SETTINGS)


async def store_snapshot(snapshot: ChainSnapshot) -> str:
    """Persist `snapshot` under a fresh random token and return the token.

    Called every time the chain stops for confirmation -- including a
    second (or third) stop on a resumed chain, so each round trip gets its
    own fresh, single-purpose token rather than reusing one across an
    entire multi-confirmation conversation.
    """
    token = secrets.token_urlsafe(32)
    pool = await _redis_pool()
    try:
        await pool.set(_KEY_PREFIX + token, snapshot.to_json(), ex=_TTL_SECONDS)
    finally:
        await pool.aclose()
    return token


async def load_snapshot(token: str) -> Optional[ChainSnapshot]:
    """Return the snapshot for `token`, or None if it is unknown or expired.

    Callers must NOT fall back to re-planning when this returns None -- that
    reintroduces the double-charge/misbound-mask bug this module exists to
    fix. Surface a clean error instead (see ai_command.ai_command's
    resume_token branch).
    """
    pool = await _redis_pool()
    try:
        raw = await pool.get(_KEY_PREFIX + token)
    finally:
        await pool.aclose()
    if raw is None:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    return ChainSnapshot.from_json(raw)


async def delete_snapshot(token: str) -> None:
    """Remove a token. Called once a chain finishes successfully, and also
    as soon as a resume request's token has been loaded and verified --
    each token is single-use; a chain that stops again gets a brand new one
    from store_snapshot rather than this one being reused."""
    pool = await _redis_pool()
    try:
        await pool.delete(_KEY_PREFIX + token)
    finally:
        await pool.aclose()
