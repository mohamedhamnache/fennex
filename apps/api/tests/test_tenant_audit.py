"""Every resource-id route must scope to the caller's organisation.

Two cross-tenant holes reached working code and neither was found by review:
one read another org's revenue, one queued a paid job that billed another
org's credits. Both were found by accident. This is the check that stops the
third.

A green audit proves nothing on its own, so most of this file is negative
controls: synthetic handlers with a KNOWN leak, asserted to be caught. If the
detector ever silently stops detecting, these fail rather than the audit
quietly reporting zero forever.
"""
import ast

import pytest

from app.core import tenant_audit


def _scan(source: str, monkeypatch, tmp_path):
    """Run the audit over one synthetic router file."""
    f = tmp_path / "synthetic.py"
    f.write_text(source)
    monkeypatch.setattr(tenant_audit, "ROUTERS", tmp_path)
    return tenant_audit.unscoped_routes()


class TestTheRealCodebase:
    def test_no_route_takes_a_resource_id_without_scoping_it(self):
        found = tenant_audit.unscoped_routes()
        assert found == [], (
            "these routes accept a client-supplied resource id without constraining it "
            f"to the caller's organisation: {found}")

    def test_every_allowlist_entry_still_exists(self):
        """A stale allowlist is worse than none: it silently exempts whatever
        later takes that name."""
        import pathlib
        names = set()
        for p in tenant_audit.ROUTERS.rglob("*.py"):
            tree = ast.parse(p.read_text())
            for fn in ast.walk(tree):
                if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    names.add(f"{p.name}::{fn.name}")
        stale = tenant_audit.ALLOWLIST - names
        assert not stale, f"allowlisted handlers that no longer exist: {stale}"


class TestItActuallyDetects:
    """Negative controls. Each is a handler with a real leak in it."""

    def test_a_bare_resource_id_read_is_caught(self, monkeypatch, tmp_path):
        found = _scan('''
from fastapi import APIRouter
router = APIRouter()

@router.get("/thing")
async def read_thing(project_id, current_user, db):
    return await service.get(project_id, db)
''', monkeypatch, tmp_path)
        assert "synthetic.py::read_thing" in found

    def test_the_revenue_leak_shape_is_caught(self, monkeypatch, tmp_path):
        """The exact shape of /shopify/orders/revenue before it was fixed."""
        found = _scan('''
from fastapi import APIRouter
router = APIRouter()

@router.get("/orders/revenue")
async def shopify_revenue(project_id, current_user, db, days: int = 30):
    return await store_revenue_service.revenue_summary(project_id, db, days)
''', monkeypatch, tmp_path)
        assert "synthetic.py::shopify_revenue" in found

    def test_the_backlink_spend_shape_is_caught(self, monkeypatch, tmp_path):
        """/backlinks/analyze before the fix: no org check, and the worker it
        queues bills the org that owns the TARGET project."""
        found = _scan('''
from fastapi import APIRouter
router = APIRouter()

@router.post("/analyze")
async def analyze_backlinks(project_id, current_user, db, _):
    job = await redis.enqueue_job("sync_backlink_profile", str(project_id))
    return {"job_id": job.job_id}
''', monkeypatch, tmp_path)
        assert "synthetic.py::analyze_backlinks" in found

    def test_a_non_project_resource_id_is_caught_too(self, monkeypatch, tmp_path):
        """The blind spot in the first version of this audit. It checked
        project_id alone and passed clean while a request_id route let any user
        flip verification flags on two other organisations' agreement."""
        found = _scan('''
from fastapi import APIRouter
router = APIRouter()

@router.post("/requests/{request_id}/verify")
async def verify_request(request_id, current_user, db, side):
    return await redis.enqueue_job("verify_exchange_link", str(request_id), side)
''', monkeypatch, tmp_path)
        assert "synthetic.py::verify_request" in found


class TestItDoesNotCryWolf:
    """A noisy audit gets an allowlist entry per finding and stops meaning
    anything. These must NOT be reported."""

    def test_an_inline_org_filter_passes(self, monkeypatch, tmp_path):
        found = _scan('''
from fastapi import APIRouter
router = APIRouter()

@router.get("/thing")
async def read_thing(project_id, current_user, db):
    row = await db.execute(select(Thing).where(
        Thing.project_id == project_id, Thing.org_id == current_user.org_id))
    return row.scalar_one_or_none()
''', monkeypatch, tmp_path)
        assert found == []

    def test_scoping_pushed_into_a_helper_passes(self, monkeypatch, tmp_path):
        """Most routers load through a helper and the handler then holds no
        org_id of its own. That is good practice, and the first version of this
        audit reported twelve such handlers as violations."""
        found = _scan('''
from fastapi import APIRouter
router = APIRouter()

async def _load_or_404(article_id, current_user, db):
    return await db.execute(select(Article).where(
        Article.id == article_id, Article.org_id == current_user.org_id))

@router.get("/{article_id}/checks")
async def studio_checks(article_id, current_user, db):
    article = await _load_or_404(article_id, current_user, db)
    return {"ok": True}
''', monkeypatch, tmp_path)
        assert found == []

    def test_a_handler_with_no_database_is_ignored(self, monkeypatch, tmp_path):
        """No session, no row, nothing to leak. Unimplemented stubs live here."""
        found = _scan('''
from fastapi import APIRouter
router = APIRouter()

@router.get("/{job_id}")
async def get_job(job_id: str):
    return {"message": "Not implemented yet"}
''', monkeypatch, tmp_path)
        assert found == []

    def test_a_route_without_any_resource_id_is_ignored(self, monkeypatch, tmp_path):
        found = _scan('''
from fastapi import APIRouter
router = APIRouter()

@router.get("/me")
async def me(current_user, db):
    return current_user
''', monkeypatch, tmp_path)
        assert found == []


class TestTheFixesHold:
    """Regressions on the two handlers that actually leaked."""

    def _source(self, name: str) -> str:
        import inspect
        from app.api.v1.routers import backlinks
        return inspect.getsource(getattr(backlinks, name))

    def test_analyze_backlinks_checks_ownership_before_queueing(self):
        src = self._source("analyze_backlinks")
        assert "Project.org_id == current_user.org_id" in src
        # The check must precede the enqueue, or the job is already running.
        assert src.index("Project.org_id") < src.index("enqueue_job")

    def test_analyze_backlinks_answers_404_not_403(self):
        """403 confirms the project exists, which hands an attacker an
        enumeration oracle."""
        assert "status_code=404" in self._source("analyze_backlinks")

    def test_verify_request_requires_the_caller_to_be_a_party(self):
        src = self._source("verify_request")
        assert "requester_org_id" in src and "target_org_id" in src
        assert src.index("requester_org_id") < src.index("enqueue_job")
