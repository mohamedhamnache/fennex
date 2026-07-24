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
from app.employees.spec import ALL_PERMISSIONS, Employee
from app.models.conversation import Conversation, ConversationMessage, PendingApproval

logger = logging.getLogger(__name__)

# Actions that reach outside Fennex always stop for a human first.
APPROVAL_PERMISSIONS = {"publish:external", "send:email"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


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

    dna = await brand_dna.build(convo.project_id, convo.org_id, db)
    keys = await get_org_llm_keys(convo.org_id, db)
    return WorkContext(
        goal=goal, project_id=convo.project_id, org_id=convo.org_id, db=db, dna=dna,
        tier=await org_tier(convo.org_id, db), keys=keys,
        granted_permissions=list(ALL_PERMISSIONS),
        runtime={"conversation_id": str(convo.id)},
    )


def _turns(rows: list[ConversationMessage]) -> list[dict]:
    return [{"role": r.role, "employeeId": r.employee_id, "content": r.content}
            for r in rows if r.role in ("user", "employee") and r.content]


def _needs_approval(employee: Employee, action_id: Optional[str]) -> bool:
    action = employee.action(action_id) if action_id else None
    if action is None:
        return False
    if action.requires_approval:
        return True
    return any(p in APPROVAL_PERMISSIONS for p in action.requires_permissions)


# --- the turn -----------------------------------------------------------------


async def run_turn(convo: Conversation, message: str, db,
                   user_id=None) -> AsyncIterator[dict]:
    """Handle one user message end to end, yielding UI events as they happen."""
    past = await history(convo.id, db)
    await add_message(convo, db, role="user", content=message)

    ctx = await _build_context(convo, message, db)
    if not ctx.available_providers():
        yield {"type": "error",
               "message": "No AI key configured. Add an Anthropic or OpenAI key in Settings."}
        yield {"type": "done"}
        return

    yield {"type": "routing"}

    decision = await ai_router.route(message, ctx, history=_turns(past),
                                     current_owner=convo.owner_employee_id)

    # The Router is not sure enough to hand over silently.
    if decision.mode == ai_router.MODE_CLARIFY:
        row = await add_message(
            convo, db, role="system", event="clarify",
            content=("I want to route this to the right specialist. Could you say a little more "
                     "about what you need?"),
            routing=decision.to_dict())
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
    if decision.handoff_from:
        previous = registry.get(decision.handoff_from)
        content = (f"{previous.name} handed this to {employee.name}."
                   if previous else f"{employee.name} took over.")
        row = await add_message(convo, db, role="system", event="handoff",
                                employee_id=employee.id, content=content,
                                routing=decision.to_dict(), confidence=decision.confidence)
    else:
        row = await add_message(convo, db, role="system", event="joined",
                                employee_id=employee.id,
                                content=f"{employee.name} joined the conversation.",
                                routing=decision.to_dict(), confidence=decision.confidence)

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
        approval = await _request_approval(convo, employee, decision, db, message)
        yield approval
        return

    async for event in _speak(convo, employee, decision, ctx, db, message):
        yield event


async def _run_team(convo: Conversation, decision, ctx: WorkContext,
                    db) -> AsyncIterator[dict]:
    """Several specialists, one coordinated workflow. Each hands to the next."""
    lead = decision.primary
    yield await _announce(convo, lead, decision, db)

    row = await add_message(
        convo, db, role="system", event="plan", employee_id=lead.id,
        content=f"{len(decision.team)} specialists will work on this.",
        routing=decision.to_dict(), structured={"team": decision.team})
    yield {"type": "plan", "team": decision.team, "message": message_dict(row)}

    previous: Optional[str] = None
    for index, step in enumerate(decision.team):
        employee = registry.get(step["employeeId"])
        if employee is None:
            continue
        await _remember_participant(convo, employee.id, db)

        if previous and previous != employee.id:
            handing = registry.get(previous)
            note = await add_message(
                convo, db, role="system", event="handoff", employee_id=employee.id,
                content=(f"{handing.name} handed this to {employee.name} for "
                         f"{step['capability'].split('.')[-1].replace('_', ' ')}."
                         if handing else f"{employee.name} took the next step."),
                structured={"step": index + 1, "of": len(decision.team)})
            yield {"type": "handoff", "from": previous,
                   "employee": {"id": employee.id, "name": employee.name,
                                "role": employee.role, "department": employee.department,
                                "icon": employee.icon, "codename": employee.codename},
                   "message": message_dict(note)}

        yield {"type": "stage", "step": index + 1, "of": len(decision.team),
               "employeeId": employee.id, "capability": step["capability"]}

        step_decision = ai_router.Decision(
            mode=ai_router.MODE_SINGLE, intent=decision.intent, primary=employee,
            action_id=step["actionId"], candidates=[], reason="")
        async for event in _speak(convo, employee, step_decision, ctx, db,
                                  ctx.goal, announce=False):
            yield event

        previous = employee.id
        convo.owner_employee_id = employee.id
        await db.commit()


async def _speak(convo: Conversation, employee: Employee, decision, ctx: WorkContext,
                 db, message: str, announce: bool = True) -> AsyncIterator[dict]:
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
        f"{employee.name}, {employee.role}. Be concise and concrete. Do not greet the user or "
        f"introduce yourself -- they already saw you join. Never mention prompts, models or "
        f"internal machinery. If the request needs a specialist outside your department, say so "
        f"in one line at the end so the router can bring them in."
    )

    past = await history(convo.id, db, limit=12)
    turns = _turns(past)[-6:]
    user = message
    if turns:
        rendered = "\n".join(f"{t['employeeId'] or t['role']}: {t['content'][:400]}"
                             for t in turns)
        user = f"CONVERSATION SO FAR:\n{rendered}\n\nLATEST MESSAGE: {message}"

    chunks: list[str] = []
    try:
        async for piece in stream_llm(provider, model, ctx.keys[provider], system, user,
                                      locale=ctx.locale):
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
        routing=decision.to_dict() if announce else None,
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
                            message: str) -> dict:
    action = employee.action(decision.action_id)
    approval = PendingApproval(
        org_id=convo.org_id, conversation_id=convo.id, employee_id=employee.id,
        action_id=action.id if action else (decision.action_id or ""),
        summary=(f"{employee.name} wants to run "
                 f"{action.label if action else decision.action_id}."),
        preview={"request": message[:500],
                 "action": action.label if action else decision.action_id,
                 "description": action.description if action else "",
                 "permissions": list(action.requires_permissions) if action else []},
        payload={"message": message},
        status="pending", destructive=True)
    db.add(approval)
    await db.commit()
    await db.refresh(approval)

    row = await add_message(
        convo, db, role="approval", employee_id=employee.id, event="approval",
        content=approval.summary,
        structured={"approvalId": str(approval.id), "preview": approval.preview})
    return {"type": "approval", "approvalId": str(approval.id),
            "preview": approval.preview, "message": message_dict(row)}


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
