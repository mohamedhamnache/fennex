"""Main Chat -- the single conversational surface over the AI company."""

import json
import logging
import uuid

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.core.database import async_session_factory
from app.core.dependencies import CurrentUser, DB
from app.employees import registry
from app.models.conversation import Conversation, PendingApproval
from app.services import employee_chat

logger = logging.getLogger(__name__)

router = APIRouter()

SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


class ChatRequest(BaseModel):
    message: str
    project_id: uuid.UUID
    conversation_id: uuid.UUID | None = None
    # A model the user picked. Ignored unless it is a catalogued model on a
    # provider this organisation has configured.
    model_provider: str | None = None
    model_id: str | None = None


class ApprovalDecision(BaseModel):
    decision: str   # approved | rejected


def _conversation(convo: Conversation) -> dict:
    return {"id": str(convo.id), "title": convo.title, "status": convo.status,
            "ownerEmployeeId": convo.owner_employee_id,
            "participants": convo.participants or [],
            "projectId": str(convo.project_id),
            "createdAt": convo.created_at.isoformat() if convo.created_at else None}


@router.get("/models")
async def list_models(current_user: CurrentUser, db: DB) -> dict:
    """Models this organisation can run, for the chat picker."""
    from app.employees.runtime import models as model_provider
    from app.services.llm_service import get_org_llm_keys

    keys = await get_org_llm_keys(current_user.org_id, db)
    return {"models": model_provider.available(keys)}


@router.get("/conversations")
async def list_conversations(current_user: CurrentUser, db: DB,
                             project_id: uuid.UUID = Query(...),
                             limit: int = Query(default=30, le=100)) -> dict:
    rows = (await db.execute(
        select(Conversation)
        .where(Conversation.org_id == current_user.org_id,
               Conversation.project_id == project_id)
        .order_by(Conversation.created_at.desc()).limit(limit)
    )).scalars().all()
    return {"conversations": [_conversation(c) for c in rows]}


@router.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: uuid.UUID, current_user: CurrentUser,
                           db: DB) -> dict:
    convo = await db.get(Conversation, conversation_id)
    if convo is None or convo.org_id != current_user.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    rows = await employee_chat.history(conversation_id, db, limit=200)
    provider, model_id = employee_chat.stored_model(convo)
    return {"conversation": {**_conversation(convo),
                             "modelProvider": provider, "modelId": model_id},
            "messages": [employee_chat.message_dict(r) for r in rows]}


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: uuid.UUID, current_user: CurrentUser,
                              db: DB) -> dict:
    convo = await db.get(Conversation, conversation_id)
    if convo is None or convo.org_id != current_user.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    await db.delete(convo)
    await db.commit()
    return {"ok": True}


@router.post("/stream")
async def chat_stream(body: ChatRequest, current_user: CurrentUser, db: DB):
    """Stream a turn: routing, joins, handoffs, reply text, approvals.

    The turn runs on its own session so the stream is not bound to the
    request-scoped one, which FastAPI closes when the handler returns.
    """
    if not body.message.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message is required")

    convo = await employee_chat.get_or_create(
        body.conversation_id, body.project_id, current_user.org_id, current_user.id, db)

    if body.model_provider and body.model_id:
        from app.employees.runtime import models as model_provider
        from app.services.llm_service import get_org_llm_keys

        keys = await get_org_llm_keys(current_user.org_id, db)
        if not model_provider.is_allowed(body.model_provider, body.model_id, keys):
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "That model is not available for this organisation")
        await employee_chat.set_model(convo, body.model_provider, body.model_id, db)

    conversation_id, org_id, user_id = convo.id, current_user.org_id, current_user.id

    async def event_stream():
        yield _sse({"type": "conversation", "id": str(conversation_id)})
        try:
            async with async_session_factory() as session:
                thread = await session.get(Conversation, conversation_id)
                if thread is None or thread.org_id != org_id:
                    yield _sse({"type": "error", "message": "Conversation not found"})
                    return
                async for event in employee_chat.run_turn(
                        thread, body.message.strip(), session, user_id=user_id):
                    yield _sse(event)
        except Exception as exc:   # noqa: BLE001
            logger.exception("chat turn failed")
            yield _sse({"type": "error", "message": str(exc)})
            yield _sse({"type": "done"})

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers=SSE_HEADERS)


@router.post("/route")
async def preview_route(body: ChatRequest, current_user: CurrentUser, db: DB) -> dict:
    """Who would take this message, and why. Routing without executing."""
    from app.employees import brand_dna, router as ai_router
    from app.employees.context import WorkContext
    from app.services.agents.standalone import org_tier
    from app.services.llm_service import get_org_llm_keys

    dna = await brand_dna.build(body.project_id, current_user.org_id, db)
    ctx = WorkContext(goal=body.message, project_id=body.project_id,
                      org_id=current_user.org_id, db=db, dna=dna,
                      tier=await org_tier(current_user.org_id, db),
                      keys=await get_org_llm_keys(current_user.org_id, db))
    owner = None
    if body.conversation_id:
        convo = await db.get(Conversation, body.conversation_id)
        owner = convo.owner_employee_id if convo else None
    decision = await ai_router.route(body.message, ctx, current_owner=owner)
    return decision.to_dict()


# --- approvals ----------------------------------------------------------------


@router.get("/approvals")
async def list_approvals(current_user: CurrentUser, db: DB,
                         conversation_id: uuid.UUID | None = Query(default=None)) -> dict:
    stmt = select(PendingApproval).where(
        PendingApproval.org_id == current_user.org_id,
        PendingApproval.status == "pending")
    if conversation_id is not None:
        stmt = stmt.where(PendingApproval.conversation_id == conversation_id)
    rows = (await db.execute(stmt.order_by(PendingApproval.created_at.desc()))).scalars().all()
    return {"approvals": [
        {"id": str(a.id), "employeeId": a.employee_id, "actionId": a.action_id,
         "summary": a.summary, "preview": a.preview, "status": a.status,
         "conversationId": str(a.conversation_id) if a.conversation_id else None}
        for a in rows]}


class RunActionRequest(BaseModel):
    conversation_id: uuid.UUID
    employee_id: str
    action_id: str


class RunWorkflowRequest(BaseModel):
    conversation_id: uuid.UUID
    steps: list[dict]


class RunStepRequest(BaseModel):
    conversation_id: uuid.UUID
    steps: list[dict]
    index: int


@router.post("/workflow/step")
async def run_workflow_step(body: RunStepRequest, current_user: CurrentUser, db: DB):
    """Run one approved step of a workflow, streaming its progress."""
    convo = await db.get(Conversation, body.conversation_id)
    if convo is None or convo.org_id != current_user.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")

    conversation_id, org_id, user_id = convo.id, current_user.org_id, current_user.id

    async def event_stream():
        try:
            async with async_session_factory() as session:
                thread = await session.get(Conversation, conversation_id)
                if thread is None or thread.org_id != org_id:
                    yield _sse({"type": "error", "message": "Conversation not found"})
                    return
                async for event in employee_chat.run_step(
                        thread, body.steps, body.index, session, user_id=user_id):
                    yield _sse(event)
        except Exception as exc:   # noqa: BLE001
            logger.exception("workflow step failed")
            yield _sse({"type": "error", "message": str(exc)})
            yield _sse({"type": "done"})

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers=SSE_HEADERS)


@router.post("/workflow/run")
async def run_workflow(body: RunWorkflowRequest, current_user: CurrentUser, db: DB):
    """Execute an approved multi-specialist workflow, streaming each step."""
    convo = await db.get(Conversation, body.conversation_id)
    if convo is None or convo.org_id != current_user.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    if not body.steps:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No steps to run")

    conversation_id, org_id, user_id = convo.id, current_user.org_id, current_user.id

    async def event_stream():
        try:
            async with async_session_factory() as session:
                thread = await session.get(Conversation, conversation_id)
                if thread is None or thread.org_id != org_id:
                    yield _sse({"type": "error", "message": "Conversation not found"})
                    return
                async for event in employee_chat.run_workflow(
                        thread, body.steps, session, user_id=user_id):
                    yield _sse(event)
        except Exception as exc:   # noqa: BLE001
            logger.exception("workflow run failed")
            yield _sse({"type": "error", "message": str(exc)})
            yield _sse({"type": "done"})

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers=SSE_HEADERS)


@router.post("/actions/run")
async def run_action(body: RunActionRequest, current_user: CurrentUser, db: DB):
    """Run an action the user picked from the offered buttons."""
    convo = await db.get(Conversation, body.conversation_id)
    if convo is None or convo.org_id != current_user.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")

    conversation_id, org_id, user_id = convo.id, current_user.org_id, current_user.id

    async def event_stream():
        try:
            async with async_session_factory() as session:
                thread = await session.get(Conversation, conversation_id)
                if thread is None or thread.org_id != org_id:
                    yield _sse({"type": "error", "message": "Conversation not found"})
                    return
                async for event in employee_chat.run_action(
                        thread, body.employee_id, body.action_id, session, user_id=user_id):
                    yield _sse(event)
        except Exception as exc:   # noqa: BLE001
            logger.exception("action run failed")
            yield _sse({"type": "error", "message": str(exc)})
            yield _sse({"type": "done"})

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers=SSE_HEADERS)


@router.post("/approvals/{approval_id}/run")
async def approve_and_run(approval_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Validate the proposed action and actually execute it, streaming progress.

    Approval and execution are one call so an approved action cannot be left
    recorded-but-never-run.
    """
    try:
        await employee_chat.decide_approval(
            approval_id, current_user.org_id, "approved", current_user.id, db)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))

    org_id = current_user.org_id

    async def event_stream():
        try:
            async with async_session_factory() as session:
                approval = await session.get(PendingApproval, approval_id)
                if approval is None or approval.org_id != org_id:
                    yield _sse({"type": "error", "message": "Approval not found"})
                    return
                async for event in employee_chat.run_approved(approval, session):
                    yield _sse(event)
        except Exception as exc:   # noqa: BLE001
            logger.exception("approved action stream failed")
            yield _sse({"type": "error", "message": str(exc)})
            yield _sse({"type": "done"})

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers=SSE_HEADERS)


@router.post("/approvals/{approval_id}")
async def decide(approval_id: uuid.UUID, body: ApprovalDecision,
                 current_user: CurrentUser, db: DB) -> dict:
    try:
        approval = await employee_chat.decide_approval(
            approval_id, current_user.org_id, body.decision, current_user.id, db)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    employee = registry.get(approval.employee_id)
    return {"id": str(approval.id), "status": approval.status,
            "employee": {"id": employee.id, "name": employee.name} if employee else None}
