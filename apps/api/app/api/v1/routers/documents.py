"""Deliverables saved out of a conversation."""

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.dependencies import CurrentUser, DB
from app.models.saved_document import SavedDocument

router = APIRouter()


class SaveRequest(BaseModel):
    project_id: uuid.UUID
    title: str
    body: str
    conversation_id: uuid.UUID | None = None
    employee_id: str | None = None
    kind: str = "report"
    fmt: str = "markdown"


def _doc(row: SavedDocument, *, body: bool = False) -> dict:
    data = {
        "id": str(row.id), "title": row.title, "kind": row.kind, "fmt": row.fmt,
        "employeeId": row.employee_id, "wordCount": row.word_count,
        "projectId": str(row.project_id),
        "conversationId": str(row.conversation_id) if row.conversation_id else None,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
    }
    if body:
        data["body"] = row.body
    return data


@router.get("")
async def list_documents(current_user: CurrentUser, db: DB,
                         project_id: uuid.UUID = Query(...),
                         limit: int = Query(default=50, le=200)) -> dict:
    rows = (await db.execute(
        select(SavedDocument)
        .where(SavedDocument.org_id == current_user.org_id,
               SavedDocument.project_id == project_id)
        .order_by(SavedDocument.created_at.desc()).limit(limit)
    )).scalars().all()
    return {"documents": [_doc(r) for r in rows]}


@router.post("")
async def save_document(body: SaveRequest, current_user: CurrentUser, db: DB) -> dict:
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nothing to save")
    row = SavedDocument(
        org_id=current_user.org_id, project_id=body.project_id,
        conversation_id=body.conversation_id, title=(body.title or "Untitled")[:200],
        body=text, fmt=body.fmt, employee_id=body.employee_id, kind=body.kind,
        word_count=len(text.split()))
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _doc(row)


@router.get("/{document_id}")
async def get_document(document_id: uuid.UUID, current_user: CurrentUser, db: DB) -> dict:
    row = await db.get(SavedDocument, document_id)
    if row is None or row.org_id != current_user.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return _doc(row, body=True)


@router.delete("/{document_id}")
async def delete_document(document_id: uuid.UUID, current_user: CurrentUser, db: DB) -> dict:
    row = await db.get(SavedDocument, document_id)
    if row is None or row.org_id != current_user.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    await db.delete(row)
    await db.commit()
    return {"ok": True}
