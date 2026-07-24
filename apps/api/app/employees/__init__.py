"""Fennex AI Employee Framework.

Fennex is not a chatbot. It is a company of AI employees: the user talks to one
interface, and the Orchestrator assembles the right specialists behind it.

    app.employees.capabilities   what work exists (the taxonomy)
    app.employees.spec           what an employee is (the contract)
    app.employees.registry       who is employed (auto-discovered, never hardcoded)
    app.employees.roster         the employees themselves -- one file each
    app.employees.brand_dna      the company's identity, injected everywhere
    app.employees.memory         institutional knowledge, scoped
    app.employees.toolbelt       the software employees operate, permission-gated
    app.employees.context        the workspace handed to an employee
    app.employees.orchestrator   the CEO

Hiring an employee = adding one file to `roster/`. Nothing else changes.
"""

from app.employees import capabilities, registry, toolbelt  # noqa: F401
from app.employees.spec import Action, Employee, Outcome  # noqa: F401

__all__ = ["capabilities", "registry", "toolbelt", "Action", "Employee", "Outcome"]
