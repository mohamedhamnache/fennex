"""Project knowledge: what the agency knows without being told again.

The whole design is shaped by token cost, because a knowledge base is the
easiest way to make every prompt expensive. Three decisions carry that:

1. **Embed once, at ingest.** Chunks are embedded when a document is added and
   never again. Only the short query is embedded at retrieval.

2. **A cached digest, not the documents.** Every employee always sees a ~120
   word summary of what the project's knowledge contains -- enough to know the
   library exists and what is in it. It is regenerated only when a document
   changes, so knowing the project costs nothing per turn.

3. **Retrieval is a tool, not an injection.** Full passages reach the model
   only when an employee decides it needs them. Injecting the top matches into
   every prompt would spend thousands of tokens on turns that never use them.

Embeddings use text-embedding-3-small: at project scale a larger model buys no
retrieval quality worth its price.
"""

from __future__ import annotations

import logging
import re
import uuid
from typing import Optional

from sqlalchemy import delete, func, select

from app.models.knowledge import ProjectChunk, ProjectDocument
from app.models.project import Project

logger = logging.getLogger(__name__)

EMBED_MODEL = "text-embedding-3-small"
EMBED_DIMS = 1536

# Big enough to hold an idea, small enough that four of them are affordable.
CHUNK_CHARS = 900
CHUNK_OVERLAP = 120
MAX_CHUNKS_PER_DOC = 200
DEFAULT_TOP_K = 4
# A hard ceiling on what one retrieval may return to a model.
MAX_RETRIEVED_CHARS = 4000


# --- chunking -----------------------------------------------------------------


def chunk_text(text: str) -> list[str]:
    """Split on paragraph boundaries, packing up to the chunk size.

    Splitting mid-sentence produces passages that retrieve well and read badly,
    which shows up as an employee quoting half a thought.
    """
    cleaned = re.sub(r"\n{3,}", "\n\n", (text or "").strip())
    if not cleaned:
        return []

    paragraphs = [p.strip() for p in cleaned.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current = ""

    for paragraph in paragraphs:
        # A paragraph longer than a chunk is split on sentences rather than
        # dropped or truncated.
        if len(paragraph) > CHUNK_CHARS:
            for sentence in re.split(r"(?<=[.!?])\s+", paragraph):
                if len(current) + len(sentence) + 1 > CHUNK_CHARS and current:
                    chunks.append(current.strip())
                    current = current[-CHUNK_OVERLAP:] if CHUNK_OVERLAP else ""
                current = f"{current} {sentence}".strip()
            continue

        if len(current) + len(paragraph) + 2 > CHUNK_CHARS and current:
            chunks.append(current.strip())
            current = current[-CHUNK_OVERLAP:] if CHUNK_OVERLAP else ""
        current = f"{current}\n\n{paragraph}".strip()

    if current.strip():
        chunks.append(current.strip())
    return chunks[:MAX_CHUNKS_PER_DOC]


# --- embeddings ---------------------------------------------------------------


async def embed(texts: list[str], keys: dict) -> list[Optional[list[float]]]:
    """Embed a batch in one request. Returns None per item on failure.

    Batched deliberately: one request for forty chunks rather than forty
    requests is most of the cost difference at ingest.
    """
    if not texts:
        return []
    api_key = (keys or {}).get("openai")
    if not api_key:
        logger.info("no OpenAI key: knowledge stored without embeddings")
        return [None] * len(texts)

    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=api_key)
        response = await client.embeddings.create(model=EMBED_MODEL, input=texts)
        # Embeddings are a paid OpenAI call and were the one provider path that
        # bypassed metering entirely: ingest a large document and the supplier
        # billed us while the customer was billed nothing. Metered through the
        # same ambient helper as every other call, so it lands on the org whose
        # keys were resolved for it. Input-only -- embeddings have no output.
        try:
            from app.services.llm_service import LLMUsage, _meter_ambient
            u = getattr(response, "usage", None)
            await _meter_ambient(
                LLMUsage("openai", EMBED_MODEL,
                         input_tokens=getattr(u, "prompt_tokens", 0) or 0),
                "knowledge_embed",
            )
        except Exception:
            logger.exception("embedding usage metering failed (non-fatal)")
        return [item.embedding for item in response.data]
    except Exception:
        logger.exception("embedding failed; knowledge stored without vectors")
        return [None] * len(texts)


# --- ingest -------------------------------------------------------------------


async def add_document(project_id: uuid.UUID, org_id: uuid.UUID, *, title: str,
                       body: str, kind: str, source: Optional[str], keys: dict,
                       db) -> ProjectDocument:
    """Store a document and make it retrievable."""
    body = (body or "").strip()
    if not body:
        raise ValueError("The document is empty.")

    document = ProjectDocument(
        org_id=org_id, project_id=project_id, title=(title or "Untitled")[:300],
        kind=kind or "note", source=source, body=body,
        word_count=len(body.split()), status="processing")
    db.add(document)
    await db.commit()
    await db.refresh(document)

    try:
        pieces = chunk_text(body)
        vectors = await embed(pieces, keys)
        for index, (piece, vector) in enumerate(zip(pieces, vectors)):
            db.add(ProjectChunk(document_id=document.id, project_id=project_id,
                                seq=index, text=piece, embedding=vector))
        document.chunk_count = len(pieces)
        document.status = "ready" if any(v is not None for v in vectors) else "no_vectors"
        await db.commit()
    except Exception as exc:   # noqa: BLE001
        logger.exception("failed to index document %s", document.id)
        document.status, document.error = "failed", str(exc)[:400]
        await db.commit()

    await refresh_digest(project_id, org_id, keys, db)
    await db.refresh(document)
    return document


async def delete_document(document_id: uuid.UUID, org_id: uuid.UUID, keys: dict,
                          db) -> bool:
    document = await db.get(ProjectDocument, document_id)
    if document is None or document.org_id != org_id:
        return False
    project_id = document.project_id
    await db.delete(document)
    await db.commit()
    await refresh_digest(project_id, org_id, keys, db)
    return True


async def list_documents(project_id: uuid.UUID, org_id: uuid.UUID, db) -> list[ProjectDocument]:
    rows = (await db.execute(
        select(ProjectDocument)
        .where(ProjectDocument.org_id == org_id, ProjectDocument.project_id == project_id)
        .order_by(ProjectDocument.created_at.desc())
    )).scalars().all()
    return list(rows)


# --- retrieval ----------------------------------------------------------------


async def search(project_id: uuid.UUID, query: str, keys: dict, db, *,
                 top_k: int = DEFAULT_TOP_K) -> list[dict]:
    """The passages most relevant to a question.

    Vector search when embeddings exist, keyword matching when they do not, so
    a project without an OpenAI key still gets something useful rather than
    nothing.
    """
    query = (query or "").strip()
    if not query:
        return []

    vectors = await embed([query], keys)
    vector = vectors[0] if vectors else None

    if vector is not None:
        try:
            rows = (await db.execute(
                select(ProjectChunk, ProjectDocument.title,
                       ProjectChunk.embedding.cosine_distance(vector).label("distance"))
                .join(ProjectDocument, ProjectDocument.id == ProjectChunk.document_id)
                .where(ProjectChunk.project_id == project_id,
                       ProjectChunk.embedding.is_not(None))
                .order_by("distance").limit(top_k)
            )).all()
            return _render([(r[0], r[1], 1.0 - float(r[2])) for r in rows])
        except Exception:
            logger.exception("vector search failed; falling back to keywords")

    words = [w for w in re.findall(r"[^\W\d_]{3,}", query.lower()) if len(w) > 3][:6]
    if not words:
        return []
    condition = ProjectChunk.text.ilike(f"%{words[0]}%")
    for word in words[1:]:
        condition = condition | ProjectChunk.text.ilike(f"%{word}%")
    rows = (await db.execute(
        select(ProjectChunk, ProjectDocument.title)
        .join(ProjectDocument, ProjectDocument.id == ProjectChunk.document_id)
        .where(ProjectChunk.project_id == project_id, condition).limit(top_k)
    )).all()
    return _render([(r[0], r[1], None) for r in rows])


def _render(rows) -> list[dict]:
    """Trim to a budget: relevance falls off faster than cost does."""
    out, spent = [], 0
    for chunk, title, score in rows:
        text = chunk.text.strip()
        if spent + len(text) > MAX_RETRIEVED_CHARS:
            text = text[: max(MAX_RETRIEVED_CHARS - spent, 0)]
        if not text:
            break
        spent += len(text)
        out.append({"document": title, "text": text,
                    "relevance": round(score, 3) if score is not None else None})
    return out


# --- digest -------------------------------------------------------------------


async def refresh_digest(project_id: uuid.UUID, org_id: uuid.UUID, keys: dict,
                         db) -> str:
    """A short standing summary of what this project's knowledge covers.

    Regenerated only when the library changes, then carried in every prompt --
    which is what lets an employee know the material exists without paying to
    re-read it each turn.
    """
    documents = await list_documents(project_id, org_id, db)
    project = await db.get(Project, project_id)
    if project is None:
        return ""

    if not documents:
        project.knowledge_digest = None
        await db.commit()
        return ""

    titles = ", ".join(d.title for d in documents[:12])
    # A cheap deterministic digest is the floor; the model only sharpens it.
    digest = f"{len(documents)} document(s) on file: {titles}."

    providers = list((keys or {}).keys())
    if providers:
        try:
            from app.services.agents import cascade

            # Openings only: summarising every document in full would cost more
            # than the digest can ever save.
            excerpt = "\n\n".join(
                f"### {d.title}\n{d.body[:1200]}" for d in documents[:6])
            system = (
                "Summarise what this project's own documents establish, for a marketing "
                "team that must not contradict them. 120 words maximum. State facts, "
                "names, positioning and rules -- not what the documents are 'about'.\n"
                "Reply with PLAIN PROSE only: no JSON, no code fences, no markdown "
                "headings, no preamble. The text is pasted directly into another "
                "prompt, so anything structural becomes noise there."
            )
            # A cheap model's failure mode here is exactly what _plain_prose already
            # guards against downstream: JSON or a fenced block instead of the plain
            # prose asked for. The cascade validator reuses that same check, so a
            # response that would be thrown away below instead gets one escalation
            # first (spec 3.4.3 -- cheap models fail on format, not on taste).
            summary = await cascade.call_with_cascade(
                keys=keys, feature="document_digest", system_prompt=system,
                user_prompt=excerpt, locale=getattr(project, "locale", "en"),
                validate=lambda text: bool(_plain_prose(text)))
            cleaned = _plain_prose(summary)
            if cleaned:
                digest = cleaned[:1200]
        except Exception:
            logger.exception("digest generation failed; keeping the listing")

    project.knowledge_digest = digest
    await db.commit()
    return digest


def _plain_prose(text: Optional[str]) -> str:
    """Keep a digest usable, whatever shape the model replied in.

    The digest is pasted straight into every prompt, so a stray JSON object or
    code fence becomes noise in every turn. Anything structural is rejected in
    favour of the deterministic listing.
    """
    value = (text or "").strip()
    if not value:
        return ""
    value = re.sub(r"^```[a-z]*\s*|\s*```$", "", value).strip()
    if value.startswith(("{", "[")):
        try:
            import json as _json

            parsed = _json.loads(value)
            if isinstance(parsed, dict):
                for candidate in parsed.values():
                    if isinstance(candidate, str) and len(candidate.split()) > 10:
                        return candidate.strip()
        except Exception:
            pass
        return ""
    return value


async def stats(project_id: uuid.UUID, org_id: uuid.UUID, db) -> dict:
    documents = await list_documents(project_id, org_id, db)
    chunks = (await db.execute(
        select(func.count()).select_from(ProjectChunk)
        .where(ProjectChunk.project_id == project_id)
    )).scalar() or 0
    return {"documents": len(documents), "chunks": int(chunks),
            "words": sum(d.word_count for d in documents)}
