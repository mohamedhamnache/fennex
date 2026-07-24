"""Shared memory -- the company's institutional knowledge.

Employees do not carry private state between runs. Everything worth keeping is
written here, scoped, and read back by whoever is entitled to see it. That is
what turns a set of one-shot prompts into an organisation that compounds.

Scope is a property of the memory, set when it is written, and it decides who
may read it:

    self        only the employee that wrote it
    department  everyone in that department
    project     everyone working on that project
    org         the whole company

An employee's own `memory_scope` says what it WRITES at; it never restricts
what it may read. So Oasis writes research at org scope (company-wide truth)
while still reading project knowledge, and nobody reads Dune's private notes.

Retrieval is pluggable. The default backend ranks on keyword overlap, weight and
recency -- no extra infrastructure. Configure a vector backend (`set_backend`)
and the same API starts doing semantic recall over `EmployeeMemory.embedding`.
"""

from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Protocol

from sqlalchemy import select

from app.employees.spec import SCOPE_DEPARTMENT, SCOPE_ORG, SCOPE_PROJECT, SCOPE_SELF, SCOPES
from app.models.employee_memory import EmployeeMemory

logger = logging.getLogger(__name__)

_STOPWORDS = {
    "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "from",
    "our", "your", "we", "you", "it", "is", "are", "be", "that", "this", "how",
    "what", "make", "create", "write", "generate", "new", "best", "about",
}


@dataclass
class Recall:
    id: str
    employee_id: str
    scope: str
    kind: str
    key: Optional[str]
    content: str
    meta: dict
    score: float

    def to_dict(self) -> dict:
        return {"id": self.id, "employeeId": self.employee_id, "scope": self.scope,
                "kind": self.kind, "key": self.key, "content": self.content,
                "meta": self.meta, "score": round(self.score, 3)}


class MemoryBackend(Protocol):
    """Ranking strategy. Swap for a vector store without touching callers."""

    async def rank(self, rows: list[EmployeeMemory], query: str, limit: int) -> list[Recall]: ...

    async def embed(self, text: str) -> Optional[list[float]]: ...


# --- default backend ----------------------------------------------------------


def _tokens(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9]{3,}", (text or "").lower())
    return {w for w in words if w not in _STOPWORDS}


class KeywordBackend:
    """Recency-weighted keyword overlap. No external dependency."""

    async def rank(self, rows, query: str, limit: int) -> list[Recall]:
        q = _tokens(query)
        now = datetime.now(timezone.utc)
        out: list[Recall] = []
        for row in rows:
            overlap = 0.0
            if q:
                haystack = _tokens(f"{row.key or ''} {row.content}")
                if haystack:
                    overlap = len(q & haystack) / len(q)
            created = row.created_at or now
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            age_days = max((now - created).total_seconds() / 86400.0, 0.0)
            recency = 1.0 / (1.0 + age_days / 30.0)          # half-life ~1 month
            score = (overlap * 2.0) + (recency * 0.6) + (float(row.weight or 1.0) * 0.4)
            out.append(Recall(id=str(row.id), employee_id=row.employee_id, scope=row.scope,
                              kind=row.kind, key=row.key, content=row.content,
                              meta=dict(row.meta or {}), score=score))
        out.sort(key=lambda r: -r.score)
        return out[:limit]

    async def embed(self, text: str):
        return None


_backend: MemoryBackend = KeywordBackend()


def set_backend(backend: MemoryBackend) -> None:
    """Install a vector backend. Called once at startup when configured."""
    global _backend
    _backend = backend


def get_backend() -> MemoryBackend:
    return _backend


# --- writing ------------------------------------------------------------------


async def remember(db, *, org_id: uuid.UUID, project_id: Optional[uuid.UUID], employee_id: str,
                   content: str, scope: str = SCOPE_PROJECT, kind: str = "note",
                   key: Optional[str] = None, meta: Optional[dict] = None,
                   department: Optional[str] = None, weight: float = 1.0) -> Optional[str]:
    """Write one memory. Re-writing the same `key` reinforces instead of duplicating."""
    content = (content or "").strip()
    if not content:
        return None
    if scope not in SCOPES:
        scope = SCOPE_PROJECT

    try:
        existing = None
        if key:
            existing = (await db.execute(
                select(EmployeeMemory).where(
                    EmployeeMemory.org_id == org_id,
                    EmployeeMemory.employee_id == employee_id,
                    EmployeeMemory.key == key,
                ).limit(1)
            )).scalars().first()

        if existing is not None:
            existing.content = content[:8000]
            existing.meta = meta or existing.meta
            existing.weight = min(float(existing.weight or 1.0) + 0.25, 5.0)
            await db.commit()
            return str(existing.id)

        row = EmployeeMemory(
            org_id=org_id, project_id=project_id, employee_id=employee_id,
            department=department, scope=scope, kind=kind, key=key,
            content=content[:8000], meta=meta or {}, weight=weight,
            embedding=await _backend.embed(content),
        )
        db.add(row)
        await db.commit()
        return str(row.id)
    except Exception:
        logger.exception("failed to write employee memory (%s/%s)", employee_id, kind)
        try:
            await db.rollback()
        except Exception:
            pass
        return None


# --- reading ------------------------------------------------------------------


def _readable(row, *, employee_id: Optional[str], department: Optional[str],
              project_id: Optional[uuid.UUID]) -> bool:
    """Can this reader see this memory?

    Visibility is a property of the memory's own scope -- the scope it was
    WRITTEN at -- not of the reader's rank. An employee reads:

        org         everything the company knows
        project     everything known about the project it is working on
        department  what its own department recorded
        self        only what it wrote itself

    This is why Oasis writes at `org` (research is company-wide truth) yet
    still reads project knowledge: writing scope and reading rights are
    independent.
    """
    if row.scope == SCOPE_ORG:
        return True
    if row.scope == SCOPE_PROJECT:
        return project_id is None or row.project_id == project_id
    if row.scope == SCOPE_DEPARTMENT:
        return bool(department) and row.department == department
    if row.scope == SCOPE_SELF:
        return bool(employee_id) and row.employee_id == employee_id
    return False


async def recall(db, *, org_id: uuid.UUID, project_id: Optional[uuid.UUID], query: str = "",
                 employee_id: Optional[str] = None, department: Optional[str] = None,
                 scope: Optional[str] = None, kinds: Optional[list[str]] = None,
                 limit: int = 8, pool: int = 200) -> list[Recall]:
    """Read back the memories this employee is entitled to, best first.

    `scope`, when given, narrows the read to a single scope (used by the API
    for inspection); it never widens what the reader may see.
    """
    try:
        stmt = select(EmployeeMemory).where(EmployeeMemory.org_id == org_id)
        if project_id is not None:
            # org-scope memories are project-independent; everything else is not.
            stmt = stmt.where(
                (EmployeeMemory.project_id == project_id) | (EmployeeMemory.scope == SCOPE_ORG)
            )
        if scope in SCOPES:
            stmt = stmt.where(EmployeeMemory.scope == scope)
        if kinds:
            stmt = stmt.where(EmployeeMemory.kind.in_(kinds))
        stmt = stmt.order_by(EmployeeMemory.created_at.desc()).limit(pool)
        rows = list((await db.execute(stmt)).scalars().all())
    except Exception:
        logger.exception("failed to read employee memory")
        return []

    rows = [r for r in rows
            if _readable(r, employee_id=employee_id, department=department,
                         project_id=project_id)]

    hits = await _backend.rank(rows, query, limit)
    await _reinforce(db, hits)
    return hits


async def _reinforce(db, hits: list[Recall]) -> None:
    """A memory that gets recalled is a memory worth keeping."""
    if not hits:
        return
    try:
        ids = [uuid.UUID(h.id) for h in hits]
        rows = (await db.execute(
            select(EmployeeMemory).where(EmployeeMemory.id.in_(ids))
        )).scalars().all()
        for row in rows:
            row.hits = int(row.hits or 0) + 1
        await db.commit()
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass


def as_prompt(hits: list[Recall]) -> str:
    """Render recalled memory for injection into a system prompt."""
    if not hits:
        return ""
    lines = ["INSTITUTIONAL MEMORY -- what this company already learned. "
             "Build on it; do not repeat work that is already done."]
    for h in hits:
        label = h.key or h.kind
        lines.append(f"- [{h.employee_id}/{label}] {h.content[:400]}")
    return "\n".join(lines)


async def forget(db, *, org_id: uuid.UUID, memory_id: uuid.UUID) -> bool:
    try:
        row = await db.get(EmployeeMemory, memory_id)
        if row is None or row.org_id != org_id:
            return False
        await db.delete(row)
        await db.commit()
        return True
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass
        return False
