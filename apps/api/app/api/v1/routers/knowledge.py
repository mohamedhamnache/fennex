"""What the agency knows about a project."""

import uuid

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel

from app.core.dependencies import CurrentUser, DB
from app.services import knowledge_service
from app.services.llm_service import get_org_llm_keys

router = APIRouter()

# Anything larger is a document nobody will read in full anyway, and embedding
# it costs more than it returns.
MAX_UPLOAD_BYTES = 2 * 1024 * 1024
TEXTUAL = (".txt", ".md", ".markdown", ".csv", ".json", ".html", ".htm")


class NoteRequest(BaseModel):
    project_id: uuid.UUID
    title: str
    body: str
    kind: str = "note"


def _doc(row) -> dict:
    return {"id": str(row.id), "title": row.title, "kind": row.kind,
            "source": row.source, "wordCount": row.word_count,
            "chunkCount": row.chunk_count, "status": row.status, "error": row.error,
            "createdAt": row.created_at.isoformat() if row.created_at else None}


@router.get("")
async def list_knowledge(current_user: CurrentUser, db: DB,
                         project_id: uuid.UUID = Query(...)) -> dict:
    documents = await knowledge_service.list_documents(project_id, current_user.org_id, db)
    from app.models.project import Project

    project = await db.get(Project, project_id)
    return {
        "documents": [_doc(d) for d in documents],
        "stats": await knowledge_service.stats(project_id, current_user.org_id, db),
        "digest": getattr(project, "knowledge_digest", None) if project else None,
    }


@router.post("/note")
async def add_note(body: NoteRequest, current_user: CurrentUser, db: DB) -> dict:
    keys = await get_org_llm_keys(current_user.org_id, db)
    try:
        document = await knowledge_service.add_document(
            body.project_id, current_user.org_id, title=body.title, body=body.body,
            kind=body.kind, source=None, keys=keys, db=db)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    return _doc(document)


@router.post("/upload")
async def upload(current_user: CurrentUser, db: DB,
                 project_id: uuid.UUID = Form(...),
                 file: UploadFile = File(...)) -> dict:
    name = (file.filename or "document").strip()
    if not name.lower().endswith(TEXTUAL):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Upload a text document ({', '.join(TEXTUAL)}). "
            "Paste the contents as a note for anything else.")

    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "That file is too large. Split it or paste the part that matters.")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="ignore")

    keys = await get_org_llm_keys(current_user.org_id, db)
    try:
        document = await knowledge_service.add_document(
            project_id, current_user.org_id, title=name, body=text, kind="file",
            source=name, keys=keys, db=db)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    return _doc(document)


@router.post("/search")
async def search(body: NoteRequest, current_user: CurrentUser, db: DB) -> dict:
    """Preview what the agency would retrieve for a question."""
    keys = await get_org_llm_keys(current_user.org_id, db)
    return {"passages": await knowledge_service.search(
        body.project_id, body.body, keys, db)}


@router.delete("/{document_id}")
async def remove(document_id: uuid.UUID, current_user: CurrentUser, db: DB) -> dict:
    keys = await get_org_llm_keys(current_user.org_id, db)
    if not await knowledge_service.delete_document(document_id, current_user.org_id, keys, db):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return {"ok": True}
