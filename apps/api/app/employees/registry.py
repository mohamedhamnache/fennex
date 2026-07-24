"""The Employee Registry -- single source of truth for the AI company.

Employees are never hardcoded into the application. Every module under
`app/employees/roster/` that exposes an `EMPLOYEE` (or `EMPLOYEES`) is
discovered and registered at import time. Dropping a file in that package hires
an employee; deleting it fires one. Nothing else in the codebase changes.

The registry also carries the capability index the Orchestrator uses to
assemble teams, so selection stays name-free and survives roster growth.

Versioning: several versions of the same employee may be installed at once.
`get(id)` resolves the highest active version; `get(id, version=...)` pins one.
"""

from __future__ import annotations

import importlib
import logging
import pkgutil
import threading
from typing import Iterable, Optional

from app.employees.spec import Employee, STATUS_ACTIVE, STATUS_BETA, STATUS_DISABLED

logger = logging.getLogger(__name__)

ROSTER_PACKAGE = "app.employees.roster"

_lock = threading.RLock()
_employees: dict[tuple[str, str], Employee] = {}    # (id, version) -> Employee
_loaded = False


# --- version helpers ----------------------------------------------------------


def _version_key(v: str) -> tuple:
    parts = []
    for chunk in (v or "0").split("."):
        digits = "".join(c for c in chunk if c.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts + [0, 0, 0])[:3]


# --- registration -------------------------------------------------------------


def register(employee: Employee, *, replace: bool = False) -> Employee:
    """Install an employee. Used by discovery and by runtime installation."""
    key = (employee.id, employee.version)
    with _lock:
        if key in _employees and not replace:
            raise ValueError(f"employee {employee.id} v{employee.version} already registered")
        _employees[key] = employee
    return employee


def unregister(employee_id: str, version: Optional[str] = None) -> int:
    """Remove an employee (all versions unless one is named). Returns count."""
    with _lock:
        keys = [k for k in _employees if k[0] == employee_id and (version is None or k[1] == version)]
        for k in keys:
            del _employees[k]
    return len(keys)


def set_status(employee_id: str, status: str, version: Optional[str] = None) -> int:
    """Enable/disable/deprecate without uninstalling."""
    changed = 0
    with _lock:
        for (eid, ver), emp in _employees.items():
            if eid == employee_id and (version is None or ver == version):
                emp.status = status
                changed += 1
    return changed


# --- discovery ----------------------------------------------------------------


def _discover() -> None:
    """Import every roster module and register what it exposes."""
    global _loaded
    with _lock:
        if _loaded:
            return
        _loaded = True   # set first: a failing module must not retrigger discovery

    try:
        package = importlib.import_module(ROSTER_PACKAGE)
    except Exception:
        logger.exception("employee roster package is not importable")
        return

    for mod_info in pkgutil.iter_modules(package.__path__):
        if mod_info.name.startswith("_"):
            continue
        name = f"{ROSTER_PACKAGE}.{mod_info.name}"
        try:
            module = importlib.import_module(name)
        except Exception:
            # One broken employee must never take the company down.
            logger.exception("failed to load employee module %s", name)
            continue
        found: list[Employee] = []
        one = getattr(module, "EMPLOYEE", None)
        if isinstance(one, Employee):
            found.append(one)
        many = getattr(module, "EMPLOYEES", None)
        if isinstance(many, (list, tuple)):
            found.extend(e for e in many if isinstance(e, Employee))
        if not found:
            logger.warning("employee module %s exposes no EMPLOYEE", name)
            continue
        for emp in found:
            try:
                register(emp, replace=True)
            except Exception:
                logger.exception("failed to register employee from %s", name)


def reload() -> None:
    """Force rediscovery -- used by tests and by hot-install flows."""
    global _loaded
    with _lock:
        _employees.clear()
        _loaded = False
    _discover()


# --- lookup -------------------------------------------------------------------


def all_employees(*, include_disabled: bool = False) -> list[Employee]:
    """Latest version of every employee, ordered by department then name."""
    _discover()
    latest: dict[str, Employee] = {}
    for (eid, _ver), emp in _employees.items():
        if not include_disabled and emp.status == STATUS_DISABLED:
            continue
        cur = latest.get(eid)
        if cur is None or _version_key(emp.version) > _version_key(cur.version):
            latest[eid] = emp
    return sorted(latest.values(), key=lambda e: (e.department, e.name))


def versions(employee_id: str) -> list[str]:
    _discover()
    vs = [k[1] for k in _employees if k[0] == employee_id]
    return sorted(vs, key=_version_key)


def get(employee_id: str, version: Optional[str] = None) -> Optional[Employee]:
    _discover()
    if version is not None:
        return _employees.get((employee_id, version))
    candidates = [e for (eid, _v), e in _employees.items() if eid == employee_id]
    if not candidates:
        return None
    live = [e for e in candidates if e.status != STATUS_DISABLED] or candidates
    return max(live, key=lambda e: _version_key(e.version))


def departments() -> dict[str, list[Employee]]:
    out: dict[str, list[Employee]] = {}
    for e in all_employees():
        out.setdefault(e.department, []).append(e)
    return out


# --- capability index ---------------------------------------------------------


def capability_index() -> dict[str, list[Employee]]:
    """capability slug -> employees that cover it, best first."""
    index: dict[str, list[Employee]] = {}
    for e in all_employees():
        for c in e.capabilities:
            index.setdefault(c, [])
    for c in index:
        index[c] = find_by_capability(c)
    return index


def find_by_capability(capability: str, *, include_beta: bool = True) -> list[Employee]:
    """Employees that can do this, best first.

    Ranking: an employee with an action actually bound to the capability beats
    one that merely declares it; active beats beta beats deprecated; then the
    more specialised employee (fewer total capabilities) wins, because a
    narrow specialist outperforms a generalist on its own turf.
    """
    _discover()
    order = {STATUS_ACTIVE: 0, STATUS_BETA: 1}
    out = []
    for e in all_employees():
        if not e.covers(capability):
            continue
        if e.status == STATUS_BETA and not include_beta:
            continue
        if e.status not in order:
            continue
        backed = 0 if e.actions_for(capability) else 1
        out.append((backed, order[e.status], len(e.capabilities), e))
    out.sort(key=lambda t: (t[0], t[1], t[2]))
    return [t[3] for t in out]


def best_for(capability: str) -> Optional[Employee]:
    found = find_by_capability(capability)
    return found[0] if found else None


def resolve_action(capability: str):
    """(employee, action) pair that best answers a capability, or (None, None)."""
    for e in find_by_capability(capability):
        actions = e.actions_for(capability)
        if actions:
            return e, actions[0]
    return None, None


def find_for_goals(wanted: Iterable[str]) -> list[Employee]:
    """Smallest sensible team covering the wanted capabilities.

    Greedy set cover: repeatedly hire whoever closes the most open capabilities.
    This is how the Orchestrator assembles a squad without ever naming anyone.
    """
    open_caps = {c for c in wanted if c}
    team: list[Employee] = []
    pool = all_employees()
    while open_caps:
        best, best_hit = None, 0
        for e in pool:
            if e in team:
                continue
            hit = len(open_caps & set(e.capabilities))
            if hit > best_hit:
                best, best_hit = e, hit
        if best is None:
            break
        team.append(best)
        open_caps -= set(best.capabilities)
    return team


def catalog_text() -> str:
    """Roster catalog for orchestrator prompts -- capabilities, not personalities."""
    lines = []
    for e in all_employees():
        for a in e.actions:
            lines.append(f"- {e.id}.{a.id} ({e.department} / {e.role}): {a.description} "
                         f"[covers: {', '.join(a.capabilities)}]")
    return "\n".join(lines)


def stats() -> dict:
    emps = all_employees(include_disabled=True)
    return {
        "employees": len(emps),
        "active": sum(1 for e in emps if e.status == STATUS_ACTIVE),
        "departments": len({e.department for e in emps}),
        "actions": sum(len(e.actions) for e in emps),
        "capabilities": len({c for e in emps for c in e.capabilities}),
    }
