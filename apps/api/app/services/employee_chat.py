"""Main Chat -- one assistant on the surface, the whole company underneath.

The user types naturally. This service routes the message, hands the thread to
the right specialist, streams the reply in that specialist's voice, and moves
ownership on when someone else is better suited. The person never picks anyone.

Turn shape (each stage is emitted as it happens, so the UI can animate it):

    routing    the Router is thinking
    joined     an employee took the conversation
    handoff    ownership moved, with the reason
    stage      a team run entered its next step
    delta      streamed reply text
    approval   a destructive action is waiting for sign-off
    done       the turn is finished
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator, Optional

from sqlalchemy import func, select

from app.employees import brand_dna, memory as memory_layer, registry, router as ai_router
from app.employees.context import Task, WorkContext
from app.employees.spec import ALL_PERMISSIONS, Employee, Outcome
from app.models.conversation import Conversation, ConversationMessage, PendingApproval

logger = logging.getLogger(__name__)

# Actions that reach outside Fennex always stop for a human first.
APPROVAL_PERMISSIONS = {"publish:external", "send:email"}

# Real work -- producing an artifact or spending credits -- is proposed, never
# performed unannounced. The employee says what it intends to do and waits for
# the user to validate it.
PROPOSE_PERMISSIONS = {"write:content", "write:images", "write:social",
                       "publish:external", "send:email", "spend:credits"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _t(key: str, **params) -> dict:
    """Attach a translation key to a system notice.

    The English `content` stays as the stored transcript and as a fallback;
    the UI renders `structured.i18n` in the project's language so a French
    project does not read "Dune joined the conversation" mid-thread.
    """
    return {"i18n": {"key": key, "params": params}}


# --- conversation plumbing ----------------------------------------------------


async def get_or_create(conversation_id: Optional[uuid.UUID], project_id: uuid.UUID,
                        org_id: uuid.UUID, user_id, db) -> Conversation:
    if conversation_id is not None:
        convo = await db.get(Conversation, conversation_id)
        if convo is not None and convo.org_id == org_id:
            return convo
    convo = Conversation(org_id=org_id, project_id=project_id, user_id=user_id,
                         status="active", participants=[])
    db.add(convo)
    await db.commit()
    await db.refresh(convo)
    return convo


async def history(conversation_id: uuid.UUID, db, limit: int = 40) -> list[ConversationMessage]:
    rows = (await db.execute(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation_id)
        .order_by(ConversationMessage.seq.desc()).limit(limit)
    )).scalars().all()
    return list(reversed(rows))


async def _next_seq(conversation_id: uuid.UUID, db) -> int:
    current = (await db.execute(
        select(func.max(ConversationMessage.seq))
        .where(ConversationMessage.conversation_id == conversation_id)
    )).scalar()
    return int(current or 0) + 1


async def add_message(convo: Conversation, db, *, role: str, content: str = "",
                      employee_id: Optional[str] = None, event: Optional[str] = None,
                      routing: Optional[dict] = None, confidence: Optional[float] = None,
                      artifact_type: Optional[str] = None,
                      artifact_ids: Optional[list] = None,
                      structured: Optional[dict] = None,
                      error: Optional[str] = None) -> ConversationMessage:
    row = ConversationMessage(
        conversation_id=convo.id, seq=await _next_seq(convo.id, db), role=role,
        employee_id=employee_id, event=event, content=content or "", routing=routing,
        confidence=confidence, artifact_type=artifact_type, artifact_ids=artifact_ids,
        structured=structured, error=error)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


def message_dict(row: ConversationMessage) -> dict:
    return {
        "id": str(row.id), "seq": row.seq, "role": row.role,
        "employeeId": row.employee_id, "event": row.event, "content": row.content,
        "routing": row.routing, "confidence": row.confidence,
        "artifactType": row.artifact_type, "artifactIds": row.artifact_ids,
        "structured": row.structured, "error": row.error,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
    }


async def _remember_participant(convo: Conversation, employee_id: str, db) -> None:
    participants = list(convo.participants or [])
    if employee_id not in participants:
        participants.append(employee_id)
        convo.participants = participants
        await db.commit()


# --- context ------------------------------------------------------------------


async def _build_context(convo: Conversation, goal: str, db) -> WorkContext:
    """Every employee receives Brand DNA and institutional memory automatically,
    so nobody asks twice for something the company already knows."""
    from app.services.agents.standalone import org_tier
    from app.services.llm_service import get_org_llm_keys

    from app.services.connector_service import resolved_servers

    dna = await brand_dna.build(convo.project_id, convo.org_id, db)
    keys = await get_org_llm_keys(convo.org_id, db)
    picked_provider, picked_model = stored_model(convo)
    return WorkContext(
        goal=goal, project_id=convo.project_id, org_id=convo.org_id, db=db, dna=dna,
        tier=await org_tier(convo.org_id, db), keys=keys,
        granted_permissions=list(ALL_PERMISSIONS),
        connectors=await resolved_servers(convo.org_id, db),
        model_provider_override=picked_provider,
        model_override=picked_model,
        runtime={"conversation_id": str(convo.id)},
    )


def _turns(rows: list[ConversationMessage]) -> list[dict]:
    return [{"role": r.role, "employeeId": r.employee_id, "content": r.content}
            for r in rows if r.role in ("user", "employee") and r.content]


async def _thread_state(convo: Conversation, db) -> str:
    """What this conversation has already established and produced.

    Without it, each turn starts cold: an employee asked to "now write the
    social posts" would not know an article already exists, and would ask the
    user for a subject they already gave.
    """
    lines: list[str] = []
    brief = _stored_brief(convo)
    if brief.get("title"):
        lines.append(f"Subject agreed with the user: {brief['title']}")
    if brief.get("keyword"):
        lines.append(f"Primary keyword: {brief['keyword']}")

    delivered: list[str] = []
    for row in await history(convo.id, db, limit=60):
        if row.event != "result":
            continue
        who = registry.get(row.employee_id) if row.employee_id else None
        delivered.append(
            f"- {who.name if who else row.employee_id} produced "
            f"{row.artifact_type or 'output'}: {(row.content or '')[:160]}")
    if delivered:
        lines.append("Already delivered in this conversation -- build on it, never "
                     "redo it and never ask for it again:\n" + "\n".join(delivered[-6:]))
    return "\n".join(lines)


def _needs_approval(employee: Employee, action_id: Optional[str]) -> bool:
    """Reaches outside Fennex -- gate it before the employee even speaks."""
    action = employee.action(action_id) if action_id else None
    if action is None:
        return False
    if action.requires_approval:
        return True
    return any(p in APPROVAL_PERMISSIONS for p in action.requires_permissions)


def _should_propose(employee: Employee, action_id: Optional[str]) -> bool:
    """Produces an artifact or spends credits -- propose it, then wait."""
    action = employee.action(action_id) if action_id else None
    if action is None:
        return False
    return (action.weight == "heavy"
            or any(p in PROPOSE_PERMISSIONS for p in action.requires_permissions))


def _offerable_actions(employee: Employee, decision) -> list:
    """What this employee can actually do next, best match first.

    The one the Router picked leads; the employee's other real actions follow,
    so the user can redirect ("actually, just do the visual") with one click
    instead of another round of typing.
    """
    offered = []
    chosen = employee.action(decision.action_id) if decision.action_id else None
    if chosen is not None and _should_propose(employee, chosen.id):
        offered.append(chosen)
    for action in employee.actions:
        if action is chosen or not _should_propose(employee, action.id):
            continue
        offered.append(action)
    return offered[:4]


async def _offer_actions(convo: Conversation, employee: Employee, actions: list,
                         db) -> dict:
    """Offer the work as buttons. Nothing runs until one is pressed."""
    payload = [
        {"actionId": a.id, "label": a.label, "description": a.description,
         "outputs": list(a.outputs), "permissions": list(a.requires_permissions),
         "weight": a.weight,
         "destructive": any(p in APPROVAL_PERMISSIONS for p in a.requires_permissions)}
        for a in actions
    ]
    row = await add_message(
        convo, db, role="approval", employee_id=employee.id, event="actions",
        content=f"{employee.name} can take it from here. What would you like?",
        structured={"actions": payload, "employeeId": employee.id,
                    **_t("chat.notice.actions", name=employee.name)})
    return {"type": "actions", "employeeId": employee.id, "actions": payload,
            "message": message_dict(row)}


async def run_action(convo: Conversation, employee_id: str, action_id: str, db,
                     user_id=None) -> AsyncIterator[dict]:
    """Run an action the user explicitly chose, recording the consent."""
    employee = registry.get(employee_id)
    action = employee.action(action_id) if employee else None
    if employee is None or action is None:
        yield {"type": "error", "message": "That action is no longer available."}
        yield {"type": "done"}
        return

    approval = PendingApproval(
        org_id=convo.org_id, conversation_id=convo.id, employee_id=employee.id,
        action_id=action.id, summary=f"{employee.name}: {action.label}",
        preview={"action": action.label, "description": action.description,
                 "outputs": list(action.outputs)},
        payload={"message": convo.title or ""},
        status="approved", decided_by=user_id, decided_at=_now(),
        destructive=any(p in APPROVAL_PERMISSIONS for p in action.requires_permissions))
    db.add(approval)
    await db.commit()
    await db.refresh(approval)

    async for event in run_approved(approval, db):
        yield event


# --- the turn -----------------------------------------------------------------


async def run_turn(convo: Conversation, message: str, db,
                   user_id=None, attachment_image_id=None) -> AsyncIterator[dict]:
    """Handle one user message end to end, yielding UI events as they happen."""
    past = await history(convo.id, db)

    # Resolved here, once, and scoped to the conversation's org -- an image id
    # arrives from the client and is guessable, so a bare lookup would let a
    # caller pull another organisation's image into their own prompt.
    attachment = await _resolve_attachment(attachment_image_id, convo, db)
    await add_message(convo, db, role="user", content=message,
                      structured={"attachment": attachment} if attachment else None)

    ctx = await _build_context(convo, message, db)
    # Every employee sees it, not just the image ones: a user who attaches a
    # product photo and asks Souk about it should not be told to attach it.
    ctx.runtime["attachment"] = attachment
    if not ctx.available_providers():
        yield {"type": "error",
               "message": "No AI key configured. Add an Anthropic or OpenAI key in Settings."}
        yield {"type": "done"}
        return

    yield {"type": "routing"}

    decision = await ai_router.route(message, ctx, history=_turns(past),
                                     current_owner=convo.owner_employee_id)

    # Turn the request into a real brief before anyone works from it. Without
    # this the specialists receive the raw instruction and title their output
    # with it.
    if decision.mode != ai_router.MODE_CLARIFY:
        brief = await ai_router.extract_brief(message, ctx, decision.intent)
        await _store_brief(convo, brief, db)
        if brief.get("title"):
            ctx.goal = brief["title"]
            if not convo.title or convo.title == message[:80]:
                convo.title = brief["title"][:200]
                await db.commit()

    # A greeting, a thank-you, or a question about Fennex itself. Fennex
    # answers in its own voice: waking a specialist for "how are you" both
    # misrepresents who is speaking and spends a model call on a pleasantry.
    if decision.mode == ai_router.MODE_ASSISTANT:
        async for event in _assistant_reply(convo, ctx, db, message):
            yield event
        yield {"type": "done"}
        return

    # The Router is not sure enough to hand over silently.
    if decision.mode == ai_router.MODE_CLARIFY:
        row = await add_message(
            convo, db, role="system", event="clarify",
            content=("I want to route this to the right specialist. Could you say a little more "
                     "about what you need?"),
            routing=decision.to_dict(), structured=_t("chat.notice.clarify"))
        yield {"type": "clarify", "message": message_dict(row),
               "routing": decision.to_dict()}
        yield {"type": "done"}
        return

    if decision.mode == ai_router.MODE_TEAM:
        async for event in _run_team(convo, decision, ctx, db):
            yield event
        yield {"type": "done"}
        return

    async for event in _run_single(convo, decision, ctx, db, message):
        yield event
    yield {"type": "done"}


async def _announce(convo: Conversation, employee: Employee, decision, db) -> dict:
    """The employee enters the conversation -- as a join or as a handover."""
    previous = registry.get(decision.handoff_from) if decision.handoff_from else None
    if decision.handoff_from:
        content = (f"{previous.name} handed this to {employee.name}."
                   if previous else f"{employee.name} took over.")
        row = await add_message(convo, db, role="system", event="handoff",
                                employee_id=employee.id, content=content,
                                routing=decision.to_dict(), confidence=decision.confidence,
                                structured=_t("chat.notice.handoff",
                                              from_=previous.name if previous else "",
                                              to=employee.name))
    else:
        row = await add_message(convo, db, role="system", event="joined",
                                employee_id=employee.id,
                                content=f"{employee.name} joined the conversation.",
                                routing=decision.to_dict(), confidence=decision.confidence,
                                structured=_t("chat.notice.joined", name=employee.name))

    convo.owner_employee_id = employee.id
    await db.commit()
    await _remember_participant(convo, employee.id, db)
    return {"type": "joined" if not decision.handoff_from else "handoff",
            "employee": {"id": employee.id, "name": employee.name, "role": employee.role,
                         "department": employee.department, "icon": employee.icon,
                         "codename": employee.codename},
            "from": decision.handoff_from,
            "message": message_dict(row), "routing": decision.to_dict()}


async def _run_single(convo: Conversation, decision, ctx: WorkContext, db,
                      message: str) -> AsyncIterator[dict]:
    employee = decision.primary
    yield await _announce(convo, employee, decision, db)

    if _needs_approval(employee, decision.action_id):
        yield await _request_approval(convo, employee, decision, db, message)
        return

    async for event in _speak(convo, employee, decision, ctx, db, message):
        yield event

    # The employee has explained its approach; now it offers what it can
    # actually do. Nothing runs until the user picks one.
    offered = _offerable_actions(employee, decision)
    if offered:
        yield await _offer_actions(convo, employee, offered, db)


async def _run_team(convo: Conversation, decision, ctx: WorkContext,
                    db) -> AsyncIterator[dict]:
    """Several specialists, one coordinated workflow.

    The team is proposed, not performed: the lead says in a line or two what
    the squad will produce, then the whole workflow is offered as a single
    button. Approving it runs every step for real.
    """
    lead = decision.primary
    yield await _announce(convo, lead, decision, db)

    for step in decision.team:
        await _remember_participant(convo, step["employeeId"], db)

    row = await add_message(
        convo, db, role="system", event="plan", employee_id=lead.id,
        content=f"{len(decision.team)} specialists will work on this.",
        routing=decision.to_dict(),
        structured={"team": decision.team, **_t("chat.notice.plan",
                                                count=len(decision.team))})
    yield {"type": "plan", "team": decision.team, "message": message_dict(row)}

    # A short word from the lead on what the squad will deliver -- not a
    # how-to. The work itself happens when the workflow is approved.
    async for event in _speak(convo, lead, decision, ctx, db, ctx.goal,
                              brief=True):
        yield event

    yield await _offer_workflow(convo, lead, decision.team, db)


async def _offer_workflow(convo: Conversation, lead: Employee, team: list[dict],
                          db) -> dict:
    """Offer the workflow with a button per step, each explaining itself."""
    steps = []
    for index, step in enumerate(team):
        employee = registry.get(step["employeeId"])
        action = employee.action(step["actionId"]) if employee else None
        capability = step.get("capability", "")
        steps.append({
            "index": index,
            "employeeId": step["employeeId"], "employeeName": step["employeeName"],
            "employeeRole": employee.role if employee else "",
            "actionId": step["actionId"], "icon": step.get("icon", "sparkles"),
            "department": step.get("department", ""),
            "label": action.label if action else step["actionId"],
            "description": action.description if action else "",
            "outputs": list(action.outputs) if action else [],
            "weight": action.weight if action else "light",
            "permissions": list(action.requires_permissions) if action else [],
            "capability": capability,
            # Why this specialist, in the user's terms.
            "why": _why(employee, action, capability, index),
            "dependsOnPrevious": index > 0,
        })
    names = ", ".join(s["employeeName"] for s in steps)
    row = await add_message(
        convo, db, role="approval", employee_id=lead.id, event="workflow",
        content=f"{names} are ready. Run each step when you are happy with it.",
        structured={"workflow": steps, **_t("chat.notice.workflow", names=names)})
    return {"type": "workflow", "steps": steps, "message": message_dict(row)}


def _why(employee: Optional[Employee], action, capability: str, index: int) -> str:
    """Plain-language rationale for putting this employee on this step."""
    if employee is None or action is None:
        return ""
    skill = capability.split(".", 1)[-1].replace("_", " ") if capability else action.label.lower()
    produces = ", ".join(action.outputs) or "the result"
    why = (f"{employee.name} is the {employee.role.lower()} and owns {skill}. "
           f"This step produces {produces}.")
    if index > 0:
        why += " It builds on what the previous step produced."
    if action.weight == "heavy":
        why += " It is a deep task, so it takes longer and costs more."
    return why


_INHERITED_KEYS = ("topic", "keyword", "angle", "rationale", "title", "article_id",
                   "image_id", "product_id", "primary_keyword")


def stored_model(convo: Conversation) -> tuple[Optional[str], Optional[str]]:
    """The model the user picked for this thread, if any."""
    meta = (convo.meta or {}).get("model") or {}
    return meta.get("provider"), meta.get("id")


async def set_model(convo: Conversation, provider: Optional[str], model_id: Optional[str],
                    db) -> None:
    """Remember the choice on the thread, so every later step uses it too."""
    meta = dict(convo.meta or {})
    if provider and model_id:
        meta["model"] = {"provider": provider, "id": model_id}
    else:
        meta.pop("model", None)
    convo.meta = meta
    await db.commit()


def _stored_brief(convo: Conversation) -> dict:
    return dict((convo.meta or {}).get("brief") or {})


async def _store_brief(convo: Conversation, brief: dict, db) -> None:
    """Keep the extracted brief on the thread.

    Per-step runs are separate requests, so the brief has to outlive the turn
    that produced it -- otherwise the second specialist falls back to the raw
    instruction, which is how an article ended up titled with the whole prompt.
    """
    meta = dict(convo.meta or {})
    meta["brief"] = brief
    convo.meta = meta
    await db.commit()


async def _prior_outputs(convo: Conversation, db) -> dict:
    """Everything a step should start from: the brief, then what ran before it.

    Per-step runs arrive as separate requests, so the chain cannot be held in
    memory. The thread itself is the state: every completed step left a result
    message, and its structured payload is what the next specialist inherits.
    """
    inherited: dict = {}

    # The brief comes first so a later step always knows the real subject.
    brief = _stored_brief(convo)
    for key in ("topic", "title", "keyword", "rationale"):
        if brief.get(key):
            inherited[key] = brief[key]
    if brief.get("title"):
        # The image skill reads `topic`; the writer reads `angle`/`title`.
        inherited.setdefault("angle", brief["title"])

    for row in await history(convo.id, db, limit=60):
        if row.event != "result" or not row.structured:
            continue
        for key in _INHERITED_KEYS:
            value = row.structured.get(key)
            if value:
                inherited[key] = value
        if row.artifact_ids:
            inherited.setdefault("upstream_artifacts", []).extend(row.artifact_ids)
        if row.content:
            inherited["upstream"] = row.content[:600]

    # A produced article defines the subject for everything downstream -- the
    # featured image must match the piece that was actually written.
    if inherited.get("title"):
        inherited["topic"] = inherited["title"]
    return inherited


def _follow_on(done_steps: list[dict], last_employee_id: str, limit: int = 3) -> list[dict]:
    """What the company would do next, excluding anything already planned.

    Read from the roster's own `produces_for` declarations, so the suggestion
    comes from how the company is wired rather than from a rule written here.
    """
    already = {(s.get("employeeId"), s.get("actionId")) for s in done_steps}
    covered = [s.get("capability", "") for s in done_steps]
    out = []
    for candidate in ai_router.next_steps(last_employee_id, covered, limit=limit + 2):
        if (candidate["employeeId"], candidate["actionId"]) in already:
            continue
        out.append(candidate)
    return out[:limit]


async def _offer_follow_on(convo: Conversation, follow: list[dict], db) -> dict:
    """Offer the next specialists as buttons, once the plan is delivered."""
    payload = []
    for candidate in follow:
        employee = registry.get(candidate["employeeId"])
        action = employee.action(candidate["actionId"]) if employee else None
        if employee is None or action is None:
            continue
        payload.append({
            "actionId": action.id, "employeeId": employee.id,
            "employeeName": employee.name, "employeeRole": employee.role,
            "icon": employee.icon, "department": employee.department,
            "label": action.label, "description": action.description,
            "outputs": list(action.outputs), "weight": action.weight,
            "permissions": list(action.requires_permissions),
            "destructive": any(p in APPROVAL_PERMISSIONS
                               for p in action.requires_permissions),
        })
    names = ", ".join(dict.fromkeys(p["employeeName"] for p in payload))
    row = await add_message(
        convo, db, role="approval", employee_id=payload[0]["employeeId"] if payload else None,
        event="followOn",
        content=f"That's done. {names} could take it from here.",
        structured={"followOn": payload, **_t("chat.notice.followOn", names=names)})
    return {"type": "followOn", "actions": payload, "message": message_dict(row)}


async def run_step(convo: Conversation, steps: list[dict], index: int, db,
                   user_id=None) -> AsyncIterator[dict]:
    """Run one approved step of a workflow, inheriting from the steps before it."""
    if index < 0 or index >= len(steps):
        yield {"type": "error", "message": "That step is no longer available."}
        yield {"type": "done"}
        return

    step = steps[index]
    employee = registry.get(step.get("employeeId", ""))
    action = employee.action(step.get("actionId", "")) if employee else None
    if employee is None or action is None:
        yield {"type": "error", "message": "That step is no longer available."}
        yield {"type": "done"}
        return

    brief = _stored_brief(convo)
    goal = brief.get("title") or convo.title or ""
    ctx = await _build_context(convo, goal, db)
    if not ctx.available_providers():
        yield {"type": "error",
               "message": "No AI key configured. Add an Anthropic or OpenAI key in Settings."}
        yield {"type": "done"}
        return

    if convo.owner_employee_id and convo.owner_employee_id != employee.id:
        handing = registry.get(convo.owner_employee_id)
        note = await add_message(
            convo, db, role="system", event="handoff", employee_id=employee.id,
            content=(f"{handing.name} handed this to {employee.name}."
                     if handing else f"{employee.name} took the next step."),
            structured={"step": index + 1, "of": len(steps)})
        yield {"type": "handoff", "from": convo.owner_employee_id,
               "employee": {"id": employee.id, "name": employee.name,
                            "role": employee.role, "department": employee.department,
                            "icon": employee.icon, "codename": employee.codename},
               "message": message_dict(note)}

    await _remember_participant(convo, employee.id, db)
    yield {"type": "stage", "step": index + 1, "of": len(steps),
           "employeeId": employee.id,
           "capability": step.get("capability", "")}
    yield {"type": "working", "employeeId": employee.id, "action": action.label}

    task = Task(id=f"step-{index}", goal=goal, capabilities=list(action.capabilities),
                employee_id=employee.id, action_id=action.id,
                inputs=await _prior_outputs(convo, db))
    await ctx.load_memory(employee)

    try:
        outcome = await employee.execute(action, task, ctx)
    except Exception as exc:   # noqa: BLE001
        logger.exception("workflow step failed: %s.%s", employee.id, action.id)
        outcome, error = None, str(exc)
    else:
        error = None if outcome.ok else outcome.error

    if outcome is not None and outcome.ok:
        row = await add_message(
            convo, db, role="employee", employee_id=employee.id, event="result",
            content=outcome.summary or f"{action.label} is done.",
            artifact_type=outcome.artifact_type, artifact_ids=outcome.artifact_ids,
            structured={**(outcome.structured or {}), "actionId": action.id,
                        "stepIndex": index, "label": action.label,
                        **({} if outcome.summary
                           else _t("chat.notice.actionDone", action=action.label))})
        try:
            await employee.learn(task, outcome,
                                 await employee.evaluate(outcome, task, ctx), ctx)
        except Exception:
            logger.exception("learn() failed after step")
        convo.owner_employee_id = employee.id
        await db.commit()
        yield {"type": "result", "stepIndex": index, "message": message_dict(row),
               "artifactType": outcome.artifact_type,
               "artifactIds": outcome.artifact_ids}

        # The work rarely ends here. Once the last planned step is done, offer
        # what the company would naturally do next -- an article wants a
        # campaign, a campaign wants visuals -- so the user does not have to
        # know who to ask for.
        if index == len(steps) - 1:
            follow = _follow_on(steps, employee.id)
            if follow:
                yield await _offer_follow_on(convo, follow, db)
    else:
        row = await add_message(
            convo, db, role="system", employee_id=employee.id, event="error",
            content=f"{action.label} could not be completed.", error=error,
            structured={"stepIndex": index})
        yield {"type": "error", "stepIndex": index, "employeeId": employee.id,
               "message": error or "The step failed.", "messageRow": message_dict(row)}

    yield {"type": "done"}


async def run_workflow(convo: Conversation, steps: list[dict], db,
                       user_id=None) -> AsyncIterator[dict]:
    """Execute an approved multi-specialist workflow, for real, in order.

    Each step's output feeds the next through the shared context, so the image
    artisan works from the article the writer just produced rather than from
    the original one-line request.
    """
    brief = _stored_brief(convo)
    goal = brief.get("title") or convo.title or ""
    ctx = await _build_context(convo, goal, db)
    if not ctx.available_providers():
        yield {"type": "error",
               "message": "No AI key configured. Add an Anthropic or OpenAI key in Settings."}
        yield {"type": "done"}
        return

    total = len(steps)
    previous_task: Optional[str] = None
    previous_employee: Optional[str] = None

    for index, step in enumerate(steps):
        employee = registry.get(step.get("employeeId", ""))
        action = employee.action(step.get("actionId", "")) if employee else None
        if employee is None or action is None:
            continue

        if previous_employee and previous_employee != employee.id:
            handing = registry.get(previous_employee)
            note = await add_message(
                convo, db, role="system", event="handoff", employee_id=employee.id,
                content=(f"{handing.name} handed this to {employee.name}."
                         if handing else f"{employee.name} took the next step."),
                structured={"step": index + 1, "of": total,
                            **_t("chat.notice.handoff",
                                 from_=handing.name if handing else "",
                                 to=employee.name)})
            yield {"type": "handoff", "from": previous_employee,
                   "employee": {"id": employee.id, "name": employee.name,
                                "role": employee.role, "department": employee.department,
                                "icon": employee.icon, "codename": employee.codename},
                   "message": message_dict(note)}

        yield {"type": "stage", "step": index + 1, "of": total,
               "employeeId": employee.id, "capability": action.capabilities[0]
               if action.capabilities else ""}
        yield {"type": "working", "employeeId": employee.id, "action": action.label}

        task = Task(id=f"w{index}", goal=goal, capabilities=list(action.capabilities),
                    employee_id=employee.id, action_id=action.id,
                    inputs=await _prior_outputs(convo, db),
                    depends_on=[previous_task] if previous_task else [])
        await ctx.load_memory(employee)

        try:
            outcome = await employee.execute(action, task, ctx)
        except Exception as exc:   # noqa: BLE001
            logger.exception("workflow step failed: %s.%s", employee.id, action.id)
            outcome = None
            error = str(exc)
        else:
            error = None if outcome.ok else outcome.error

        ctx.outputs[task.id] = outcome if outcome is not None else Outcome(ok=False)

        if outcome is not None and outcome.ok:
            ctx.add_artifact(outcome, employee.id, f"{employee.id}.{action.id}")
            row = await add_message(
                convo, db, role="employee", employee_id=employee.id, event="result",
                content=outcome.summary or f"{action.label} is done.",
                artifact_type=outcome.artifact_type, artifact_ids=outcome.artifact_ids,
                structured={**(outcome.structured or {}), "actionId": action.id})
            try:
                await employee.learn(task, outcome,
                                     await employee.evaluate(outcome, task, ctx), ctx)
            except Exception:
                logger.exception("learn() failed in workflow")
            yield {"type": "result", "message": message_dict(row),
                   "artifactType": outcome.artifact_type,
                   "artifactIds": outcome.artifact_ids}
            if index == total - 1:
                follow = _follow_on(steps, employee.id)
                if follow:
                    yield await _offer_follow_on(convo, follow, db)
            previous_task = task.id
        else:
            row = await add_message(
                convo, db, role="system", employee_id=employee.id, event="error",
                content=f"{action.label} could not be completed.", error=error)
            yield {"type": "error", "employeeId": employee.id,
                   "message": error or "The step failed.",
                   "messageRow": message_dict(row)}

        previous_employee = employee.id
        convo.owner_employee_id = employee.id
        await db.commit()

    yield {"type": "done"}


async def _speak(convo: Conversation, employee: Employee, decision, ctx: WorkContext,
                 db, message: str, announce: bool = True,
                 brief: bool = False) -> AsyncIterator[dict]:
    """Stream the employee's reply, in its own voice, with full context injected."""
    from app.services.agents.tiers import resolve_model
    from app.services.llm_service import stream_llm

    await ctx.load_memory(employee)
    action = employee.action(decision.action_id) if decision.action_id else None
    weight = action.weight if action else "light"
    provider, model = resolve_model(ctx.tier, weight, ctx.available_providers())

    visual = bool(action and any(c.startswith("image.") for c in action.capabilities))
    system = ctx.system_preamble(employee, visual=visual)
    system += (
        f"\n\nYou are speaking directly to the user in a chat. Stay in character as "
        f"{employee.name}, {employee.role}. Do not greet the user or introduce yourself -- they "
        f"already saw you join. Never mention prompts, models or internal machinery.\n\n"
        f"CRITICAL: you are NOT writing instructions. The user is not going to do this work -- "
        f"you are, the moment they press the button below your message. So never reply with "
        f"numbered steps, a how-to, a checklist, or advice on how something could be done. "
        f"Instead state, in your own voice, the ANGLE you will take and the JUDGEMENT behind it "
        f"-- the decision only you would make. Then stop; the button does the work."
    )
    if brief:
        system += ("\n\nKeep it to two or three sentences: what this squad will deliver and the "
                   "single decision that shapes it.")
    else:
        system += "\n\nKeep it under about six sentences."

    # Everything this thread already settled, so the employee never re-asks.
    state = await _thread_state(convo, db)
    if state:
        system += f"\n\nWHERE THIS CONVERSATION STANDS:\n{state}"

    past = await history(convo.id, db, limit=12)
    turns = _turns(past)[-6:]
    user = message
    if turns:
        rendered = "\n".join(f"{t['employeeId'] or t['role']}: {t['content'][:400]}"
                             for t in turns)
        user = f"CONVERSATION SO FAR:\n{rendered}\n\nLATEST MESSAGE: {message}"

    attached = (ctx.runtime or {}).get("attachment")
    if attached:
        user += (f"\n\nTHE USER ATTACHED AN IMAGE: {attached['url']}"
                 f" ({attached.get('width')}x{attached.get('height')}).\n"
                 "It is theirs and it is the subject of this message. You CANNOT see its "
                 "contents -- you have the URL, not the pixels -- so never describe it and "
                 "never apologise for not seeing it. Say what you can do WITH it: an image "
                 "employee can restyle, re-scene or edit it, and a product shot will use it "
                 "as the source. Never ask them to attach an image they have already "
                 "attached.")

    # What the user is charged for. Surfaced on the message so the cost of an
    # answer is visible where the answer is, rather than only in an admin
    # report -- a reseller decides whether a reply was worth its model.
    used_model, used_provider = model, provider
    prompt_tokens = completion_tokens = 0

    chunks: list[str] = []
    try:
        if action is not None and action.agentic:
            # A migrated employee reasons with its tools while it answers, so
            # the turn streams from the runtime and the user sees the work --
            # "checking Search Console" -- rather than a silent pause.
            from app.employees.runtime.base import BaseEmployee

            runner = BaseEmployee(employee)
            probe = Task(id=f"chat-{convo.id}", goal=message,
                         capabilities=list(action.capabilities),
                         employee_id=employee.id, action_id=action.id,
                         inputs=await _prior_outputs(convo, db))
            async for event in runner.stream(action, probe, ctx):
                if event["type"] == "delta":
                    chunks.append(event["text"])
                    yield event
                elif event["type"] == "tool":
                    yield {"type": "tool", "employeeId": employee.id,
                           "tool": event["tool"]}
                elif event["type"] == "telemetry":
                    # The runtime chose its own model; this is the only place
                    # that reports which one actually answered.
                    m = (event.get("metrics") or {})
                    used_model = m.get("model_id") or m.get("model") or used_model
                    used_provider = m.get("provider") or used_provider
                    prompt_tokens = m.get("promptTokens") or prompt_tokens
                    completion_tokens = m.get("completionTokens") or completion_tokens
                    yield event
                elif event["type"] == "error":
                    raise RuntimeError(event.get("message") or "stream failed")
        else:
            async for piece in stream_llm(provider, model, ctx.keys[provider], system, user,
                                          locale=ctx.locale, feature="employee_chat"):
                chunks.append(piece)
                yield {"type": "delta", "employeeId": employee.id, "text": piece}
    except Exception as exc:   # noqa: BLE001
        logger.exception("employee %s failed to reply", employee.id)
        row = await add_message(convo, db, role="employee", employee_id=employee.id,
                                content="", error=str(exc))
        yield {"type": "error", "employeeId": employee.id, "message": str(exc),
               "messageRow": message_dict(row)}
        return

    text = "".join(chunks).strip()
    row = await add_message(
        convo, db, role="employee", employee_id=employee.id, content=text,
        routing={**(decision.to_dict() if announce else {}),
                 "model": used_model, "provider": used_provider,
                 **await _message_cost(db, used_provider, used_model,
                                       prompt_tokens, completion_tokens)},
        confidence=decision.confidence if announce else None,
        structured={"actionId": decision.action_id} if decision.action_id else None)

    # The company learns from what was said, so the next turn starts warmer.
    try:
        await memory_layer.remember(
            db, org_id=convo.org_id, project_id=convo.project_id, employee_id=employee.id,
            content=text[:1000], scope=employee.memory_scope, kind="conversation",
            key=f"convo:{convo.id}:{employee.id}", department=employee.department)
    except Exception:
        logger.exception("failed to record conversation memory")

    if not convo.title:
        convo.title = message[:80]
        await db.commit()

    yield {"type": "message", "message": message_dict(row)}


# --- approvals ----------------------------------------------------------------


async def _request_approval(convo: Conversation, employee: Employee, decision, db,
                            message: str, kind: str = "approval") -> dict:
    """Ask before acting. `kind` separates a proposal ("shall I write it?") from
    a hard gate on something that leaves Fennex ("shall I publish it?")."""
    action = employee.action(decision.action_id)
    label = action.label if action else (decision.action_id or "this")
    destructive = kind == "approval"
    # Action labels are noun phrases ("Multi-network social"), so they are read
    # into the sentence rather than used as verbs.
    summary = (f"{employee.name} wants to run {label}." if destructive
               else f"{employee.name} is ready to run {label}. Shall I go ahead?")

    approval = PendingApproval(
        org_id=convo.org_id, conversation_id=convo.id, employee_id=employee.id,
        action_id=action.id if action else (decision.action_id or ""),
        summary=summary,
        preview={"request": message[:500], "action": label,
                 "kind": kind,
                 "description": action.description if action else "",
                 "outputs": list(action.outputs) if action else [],
                 "permissions": list(action.requires_permissions) if action else []},
        payload={"message": message},
        status="pending", destructive=destructive)
    db.add(approval)
    await db.commit()
    await db.refresh(approval)

    row = await add_message(
        convo, db, role="approval", employee_id=employee.id, event=kind,
        content=summary,
        structured={"approvalId": str(approval.id), "preview": approval.preview,
                    "kind": kind})
    return {"type": "approval", "approvalId": str(approval.id), "kind": kind,
            "preview": approval.preview, "message": message_dict(row)}


async def run_approved(approval: PendingApproval, db) -> AsyncIterator[dict]:
    """Execute a validated action for real, streaming progress as it runs.

    This is where the conversation stops being talk: the employee's bound skill
    runs through the same runner the orchestrator uses, so the artifact it
    produces is a real saved record, not chat text.
    """
    convo = await db.get(Conversation, approval.conversation_id)
    employee = registry.get(approval.employee_id)
    if convo is None or employee is None:
        yield {"type": "error", "message": "This action is no longer available."}
        yield {"type": "done"}
        return

    action = employee.action(approval.action_id)
    if action is None:
        yield {"type": "error", "message": f"{employee.name} no longer offers that action."}
        yield {"type": "done"}
        return

    stored = _stored_brief(convo)
    request = stored.get("title") or (approval.payload or {}).get("message", convo.title or "")
    ctx = await _build_context(convo, request, db)
    if not ctx.available_providers():
        yield {"type": "error",
               "message": "No AI key configured. Add an Anthropic or OpenAI key in Settings."}
        yield {"type": "done"}
        return

    yield {"type": "working", "employeeId": employee.id, "action": action.label}

    task = Task(id=f"approval-{approval.id}", goal=request,
                capabilities=list(action.capabilities), employee_id=employee.id,
                action_id=action.id, inputs=await _prior_outputs(convo, db))
    await ctx.load_memory(employee)

    try:
        outcome = await employee.execute(action, task, ctx)
    except Exception as exc:   # noqa: BLE001
        logger.exception("approved action failed: %s.%s", employee.id, action.id)
        outcome = None
        error = str(exc)
    else:
        error = outcome.error if not outcome.ok else None

    if outcome is not None and outcome.ok:
        row = await add_message(
            convo, db, role="employee", employee_id=employee.id, event="result",
            content=outcome.summary or f"{action.label} is done.",
            artifact_type=outcome.artifact_type, artifact_ids=outcome.artifact_ids,
            structured={**(outcome.structured or {}), "actionId": action.id,
                        **({} if outcome.summary
                           else _t("chat.notice.actionDone", action=action.label))})
        try:
            await employee.learn(task, outcome, await employee.evaluate(outcome, task, ctx), ctx)
        except Exception:
            logger.exception("learn() failed after approved action")
        yield {"type": "result", "message": message_dict(row),
               "artifactType": outcome.artifact_type,
               "artifactIds": outcome.artifact_ids}
        follow = _follow_on([{"employeeId": employee.id, "actionId": action.id,
                              "capability": (action.capabilities or [""])[0]}],
                            employee.id)
        if follow:
            yield await _offer_follow_on(convo, follow, db)
    else:
        row = await add_message(
            convo, db, role="system", employee_id=employee.id, event="error",
            content=f"{action.label} could not be completed.", error=error)
        yield {"type": "error", "employeeId": employee.id,
               "message": error or "The action failed.", "messageRow": message_dict(row)}

    yield {"type": "done"}


async def decide_approval(approval_id: uuid.UUID, org_id: uuid.UUID, decision: str,
                          user_id, db) -> PendingApproval:
    approval = await db.get(PendingApproval, approval_id)
    if approval is None or approval.org_id != org_id:
        raise ValueError("Approval not found")
    if approval.status != "pending":
        raise ValueError("This action was already decided")
    if decision not in ("approved", "rejected"):
        raise ValueError("Decision must be approved or rejected")
    approval.status = decision
    approval.decided_by = user_id
    approval.decided_at = _now()
    await db.commit()
    await db.refresh(approval)
    return approval


async def _assistant_reply(convo: Conversation, ctx: WorkContext, db, message: str):
    """Fennex answering for itself -- no specialist, no artifact.

    It knows the roster, so "what can you do" is answered from the company as
    it actually is rather than from a hardcoded blurb that drifts the moment an
    employee is hired.
    """
    from app.employees import registry
    from app.services.agents.tiers import resolve_model
    from app.services.llm_service import stream_llm

    roster = "\n".join(f"- {e.name}, {e.role}: {e.description}"
                        for e in registry.all_employees())
    system = (
        "You are Fennex, the assistant in front of a company of AI specialists in SEO, "
        "content, images and ecommerce.\n\n"

        "The user has said something conversational, or asked something outside what this "
        "company does. Answer in ONE OR TWO SHORT SENTENCES. Warm, human, never stiff.\n\n"

        "IF IT IS A GREETING OR A THANK-YOU: greet them back and offer to get started. Do not "
        "list the team unless they ask.\n\n"

        "IF IT IS OUTSIDE WHAT FENNEX DOES: say so kindly and plainly -- that it is outside "
        "what you can help with here -- then name in half a sentence what you CAN do, so they "
        "leave with a way forward rather than a refusal. Never pretend to help, never guess at "
        "an answer you have no business giving.\n\n"

        "IF THEY ASKED WHO YOU ARE OR WHAT YOU CAN DO: two or three specialists and what they "
        "would actually get, then invite the request. Never the whole roster -- a wall of names "
        "is not an answer.\n\n"

        "Speak as Fennex. Do not pretend to be one of the specialists, and do not start any "
        "work yourself.\n\n"

        f"THE TEAM BEHIND YOU:\n{roster}"
    )

    attached = (ctx.runtime or {}).get("attachment")
    if attached:
        system += ("\n\nTHE USER ATTACHED AN IMAGE. You cannot see its contents, only that "
                   "it exists. Do not describe it and do not apologise -- say what the team "
                   "can do with it (restyle it, re-scene it, use it as the source for a "
                   "product shot) and offer that.")

    providers = ctx.available_providers()
    if not providers:
        row = await add_message(convo, db, role="assistant", content=(
            "Hello. Add an AI key in Settings and I can put the team to work for you."))
        yield {"type": "message", "message": message_dict(row)}
        return

    # Always the cheap band: a pleasantry must never buy the expensive model.
    provider, model = resolve_model("economy", "light", providers)
    chunks: list[str] = []
    try:
        async for piece in stream_llm(provider, model, ctx.keys[provider], system,
                                      message, locale=ctx.locale, feature="employee_chat"):
            chunks.append(piece)
            yield {"type": "delta", "employeeId": None, "text": piece}
    except Exception as exc:  # noqa: BLE001
        logger.exception("assistant reply failed")
        row = await add_message(convo, db, role="assistant", content="", error=str(exc))
        yield {"type": "error", "employeeId": None, "message": str(exc),
               "messageRow": message_dict(row)}
        return

    row = await add_message(convo, db, role="assistant",
                            content="".join(chunks).strip(),
                            routing={"model": model, "provider": provider,
                                     "mode": "assistant"})
    yield {"type": "message", "message": message_dict(row)}


async def _message_cost(db, provider: str, model: str,
                        prompt_tokens: int, completion_tokens: int) -> dict:
    """What this reply cost, priced with the meter's own rates.

    Deliberately reads cost_rates rather than estimating: a second price table
    would drift from billing, and a cost shown beside an answer that disagrees
    with the invoice is worse than showing none. Returns {} when the rate is
    unknown, so the UI omits the figure instead of printing a confident zero.
    """
    if not provider or (prompt_tokens <= 0 and completion_tokens <= 0):
        return {}
    try:
        from app.core.credits import credits_from_micros
        from app.services.metering.meter import rate

        in_rate = await rate(db, provider, "input_token", model)
        out_rate = await rate(db, provider, "output_token", model)
        if in_rate == 0 and out_rate == 0:
            return {}
        micros = int(prompt_tokens * in_rate + completion_tokens * out_rate)
        return {"costMicros": micros, "credits": credits_from_micros(micros),
                "tokens": prompt_tokens + completion_tokens}
    except Exception:  # noqa: BLE001 - a price is never worth failing a reply
        logger.exception("could not price a chat message")
        return {}


async def _resolve_attachment(image_id, convo: Conversation, db) -> dict | None:
    """The attached image, if it belongs to this conversation's organisation."""
    if not image_id:
        return None
    from sqlalchemy import select
    from app.models.image import GeneratedImage

    row = (await db.execute(
        select(GeneratedImage.id, GeneratedImage.image_url,
               GeneratedImage.width, GeneratedImage.height)
        .where(GeneratedImage.id == image_id, GeneratedImage.org_id == convo.org_id)
    )).first()
    if row is None or not row[1]:
        return None
    return {"imageId": str(row[0]), "url": row[1], "width": row[2], "height": row[3]}
