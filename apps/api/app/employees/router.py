"""The AI Router -- orchestration, not an employee.

The user types naturally into one chat. The Router reads the request, works out
what it actually requires, and hands the conversation to the best-qualified
employee. It never performs business work itself and it never names an employee
in its own code: selection is `Employee.confidence_score()` over the registry,
so an employee registered tomorrow competes for work on equal terms.

    understand()  message + history -> capabilities, complexity, tools
    select()      capabilities -> ranked candidates -> the owner
    route()       the whole decision, including single vs. team

Conversation ownership is sticky. Once an employee owns the thread it keeps it
until the work is done, another specialist is genuinely better, or the user
changes topic -- that is what stops a follow-up like "make it shorter" from
bouncing to someone new.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Optional

from app.employees import capabilities as caps
from app.employees import registry
from app.employees.spec import Employee

logger = logging.getLogger(__name__)

MODE_SINGLE = "single"
MODE_TEAM = "team"
MODE_CLARIFY = "clarify"

# Below this, the Router is not confident enough to hand over silently.
MIN_CONFIDENCE = 0.30
# A challenger must beat the incumbent by this much to take over a live thread.
HANDOFF_MARGIN = 0.15
# More capabilities than this and the request is a project, not a message.
TEAM_THRESHOLD = 3


@dataclass
class Intent:
    """What the Router understood, before anyone is chosen."""

    capabilities: list[str] = field(default_factory=list)
    complexity: str = "simple"            # "simple" | "complex"
    tools: list[str] = field(default_factory=list)
    summary: str = ""
    topic_changed: bool = False
    source: str = "llm"                   # "llm" | "keywords"

    def to_dict(self) -> dict:
        return {"capabilities": self.capabilities, "complexity": self.complexity,
                "tools": self.tools, "summary": self.summary,
                "topicChanged": self.topic_changed, "source": self.source}


@dataclass
class Candidate:
    employee: Employee
    confidence: float
    action_id: Optional[str] = None

    def to_dict(self) -> dict:
        return {"id": self.employee.id, "name": self.employee.name,
                "role": self.employee.role, "department": self.employee.department,
                "icon": self.employee.icon, "confidence": round(self.confidence, 3),
                "actionId": self.action_id}


@dataclass
class Decision:
    """Who takes the conversation, and why."""

    mode: str
    intent: Intent
    primary: Optional[Employee] = None
    action_id: Optional[str] = None
    candidates: list[Candidate] = field(default_factory=list)
    team: list[dict] = field(default_factory=list)     # [{capability, employee_id, action_id}]
    handoff_from: Optional[str] = None
    reason: str = ""

    @property
    def confidence(self) -> float:
        return self.candidates[0].confidence if self.candidates else 0.0

    def to_dict(self) -> dict:
        return {
            "mode": self.mode,
            "intent": self.intent.to_dict(),
            "primary": self.candidates[0].to_dict() if self.candidates else None,
            "actionId": self.action_id,
            "candidates": [c.to_dict() for c in self.candidates[:4]],
            "team": self.team,
            "handoffFrom": self.handoff_from,
            "reason": self.reason,
            "confidence": round(self.confidence, 3),
        }


# --- 1. understand ------------------------------------------------------------


async def understand(message: str, ctx, history: Optional[list[dict]] = None) -> Intent:
    """Turn a natural-language message into required capabilities.

    Falls back to keyword routing when no LLM key is configured, so the chat
    still works rather than failing closed.
    """
    known = sorted({c for e in registry.all_employees() for c in e.capabilities})
    providers = ctx.available_providers()
    if not providers:
        return _keyword_intent(message, known)

    from app.services.agents.tiers import resolve_model
    from app.services.llm_service import call_llm

    provider, model = resolve_model(ctx.tier, "light", providers)
    recent = _history_text(history)
    system = (
        "You are the router for a company of AI specialists. Read the user's MESSAGE and decide "
        "what CAPABILITIES delivering it requires. Choose ONLY slugs from the CATALOG, in "
        "execution order. Most messages need 1-2; a full launch or campaign may need 4-6.\n"
        "Also judge:\n"
        '- "complexity": "simple" for one deliverable, "complex" if several specialists must '
        "collaborate.\n"
        '- "topicChanged": true if the MESSAGE moves away from what RECENT was about.\n'
        '- "summary": one short line naming the deliverable.\n'
        'Respond with ONLY JSON: {"capabilities": [...], "complexity": "...", '
        '"topicChanged": bool, "summary": "..."}.\n\n'
        f"CATALOG:\n{caps.catalog_text(known)}"
    )
    user = f"MESSAGE: {message}"
    if recent:
        user += f"\n\nRECENT:\n{recent}"

    try:
        raw = await call_llm(provider, model, ctx.keys[provider], system, user, locale=ctx.locale)
        parsed = json.loads(re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip()))
        wanted = [c for c in parsed.get("capabilities", []) if c in known][:8]
        if not wanted:
            return _keyword_intent(message, known)
        return Intent(
            capabilities=wanted,
            complexity=("complex" if parsed.get("complexity") == "complex"
                        or len(wanted) > TEAM_THRESHOLD else "simple"),
            tools=_tools_for(wanted),
            summary=str(parsed.get("summary", ""))[:200],
            topic_changed=bool(parsed.get("topicChanged", False)),
            source="llm",
        )
    except Exception:
        logger.exception("router intent failed; falling back to keywords")
        return _keyword_intent(message, known)


def _keyword_intent(message: str, known: list[str]) -> Intent:
    """No-LLM fallback: let the employees themselves vote on the raw wording.

    Each employee scores the message against its own `supported_tasks`; the
    winner's best action defines the capabilities. Still name-free.
    """
    scored = [(e.confidence_score(message, None), e) for e in registry.all_employees()]
    scored = [(s, e) for s, e in scored if s > 0]
    if not scored:
        return Intent(capabilities=[], complexity="simple", summary=message[:200],
                      source="keywords")
    scored.sort(key=lambda pair: -pair[0])
    best = scored[0][1]
    wanted = list(best.actions[0].capabilities[:2]) if best.actions else best.capabilities[:1]
    return Intent(capabilities=[c for c in wanted if c in known], complexity="simple",
                  tools=_tools_for(wanted), summary=message[:200], source="keywords")


def _tools_for(capabilities: list[str]) -> list[str]:
    """Which tools the chosen work is likely to need -- surfaced so the UI can
    warn about a disconnected app before anything runs."""
    tools: list[str] = []
    for capability in capabilities:
        employee, action = registry.resolve_action(capability)
        if employee is None:
            continue
        for tool in employee.allowed_tools:
            if tool not in tools:
                tools.append(tool)
    return tools


def _history_text(history: Optional[list[dict]], limit: int = 6) -> str:
    if not history:
        return ""
    lines = []
    for turn in history[-limit:]:
        role = turn.get("role", "user")
        who = turn.get("employeeId") or role
        content = str(turn.get("content", ""))[:300]
        if content:
            lines.append(f"{who}: {content}")
    return "\n".join(lines)


# --- 2. select ----------------------------------------------------------------


def rank(message: str, intent: Intent, *, current_owner: Optional[str] = None) -> list[Candidate]:
    """Every employee scores itself; the Router only sorts."""
    out: list[Candidate] = []
    for employee in registry.all_employees():
        confidence = employee.confidence_score(
            message, intent.capabilities, is_current_owner=(employee.id == current_owner))
        if confidence <= 0:
            continue
        action_id = None
        for capability in intent.capabilities:
            actions = employee.actions_for(capability)
            if actions:
                action_id = actions[0].id
                break
        if action_id is None and employee.actions:
            action_id = employee.actions[0].id
        out.append(Candidate(employee=employee, confidence=confidence, action_id=action_id))
    out.sort(key=lambda c: (-c.confidence, -c.employee.priority))
    return out


def build_team(intent: Intent) -> list[dict]:
    """Assign each required capability to whoever can actually act on it."""
    team: list[dict] = []
    for capability in intent.capabilities:
        employee, action = registry.resolve_action(capability)
        if employee is None or action is None:
            continue
        team.append({"capability": capability, "employeeId": employee.id,
                     "employeeName": employee.name, "actionId": action.id,
                     "icon": employee.icon, "department": employee.department})
    return team


# --- 3. route -----------------------------------------------------------------


async def route(message: str, ctx, *, history: Optional[list[dict]] = None,
                current_owner: Optional[str] = None) -> Decision:
    """The whole decision: understand, rank, and decide who takes the thread."""
    intent = await understand(message, ctx, history)
    candidates = rank(message, intent, current_owner=current_owner)

    if not candidates or candidates[0].confidence < MIN_CONFIDENCE:
        # An ambiguous message is not necessarily an unroutable one. "Make it
        # shorter" means nothing on its own, but it is obviously still for
        # whoever is holding the thread -- continuity resolves it, and only a
        # cold start with no owner genuinely needs a clarifying question.
        owner = registry.get(current_owner) if current_owner else None
        if owner is not None and not intent.topic_changed:
            return Decision(
                mode=MODE_SINGLE, intent=intent, primary=owner,
                action_id=(owner.actions[0].id if owner.actions else None),
                candidates=[Candidate(employee=owner, confidence=MIN_CONFIDENCE,
                                      action_id=(owner.actions[0].id if owner.actions else None))],
                reason=f"Follow-up: {owner.name} still owns this conversation.")
        return Decision(mode=MODE_CLARIFY, intent=intent, candidates=candidates,
                        reason="No employee is confident enough to take this on.")

    # Collaboration: several specialists, each owning a different capability.
    team = build_team(intent)
    distinct = {step["employeeId"] for step in team}
    if intent.complexity == "complex" and len(distinct) > 1:
        lead = registry.get(team[0]["employeeId"])
        return Decision(
            mode=MODE_TEAM, intent=intent, primary=lead,
            action_id=team[0]["actionId"], candidates=candidates, team=team,
            reason=f"{len(distinct)} specialists are needed for this.")

    winner = candidates[0]

    # Ownership is sticky: the incumbent keeps the thread unless a challenger is
    # clearly better, so follow-ups stay with whoever is already doing the work.
    handoff_from = None
    if current_owner and winner.employee.id != current_owner:
        incumbent = next((c for c in candidates if c.employee.id == current_owner), None)
        if (incumbent is not None and not intent.topic_changed
                and winner.confidence - incumbent.confidence < HANDOFF_MARGIN):
            winner = incumbent
        else:
            handoff_from = current_owner

    return Decision(
        mode=MODE_SINGLE, intent=intent, primary=winner.employee,
        action_id=winner.action_id, candidates=candidates, handoff_from=handoff_from,
        reason=(f"{winner.employee.name} is the strongest match "
                f"({winner.confidence:.0%} confidence)."),
    )
