"""No paid supplier call may exist without an accounting for it.

Four unmetered paths were found in one week, the largest being `stream_llm` --
at the time the path behind ALL article generation, article chat, the writing
service and the employee chat, billing the customer nothing while the supplier
billed us. Three greps looking for them produced three different wrong answers.

This is the test that makes "everything is metered" checkable instead of
believed.
"""
from app.core.metering_audit import (
    ALLOWLIST, find_unmetered_supplier_calls, _reaches_a_supplier,
)
import ast


def test_every_supplier_call_is_accounted_for():
    violations = find_unmetered_supplier_calls()
    assert violations == [], (
        "These functions spend a supplier's money with no usage event:\n  "
        + "\n  ".join(violations)
        + "\n\nMeter the call, or add it to ALLOWLIST in "
          "app/core/metering_audit.py with a note saying where it IS recorded."
    )


def test_the_allowlist_says_where_each_call_is_metered():
    """An allowlist of bare names would rot into a list nobody can check. Each
    entry has to state where the money is actually recorded."""
    for key, note in ALLOWLIST.items():
        assert note and len(note) > 10, f"{key} needs a note saying where it meters"


def test_the_audit_detects_a_new_unmetered_call():
    """The check must be able to FAIL.

    A supplier-call detector that never fires is worse than none: it reports
    that everything is metered no matter what is added.
    """
    raw_http = ast.parse(
        'async def leak():\n'
        '    async with httpx.AsyncClient() as c:\n'
        '        await c.post("https://api.openai.com/v1/chat/completions")\n'
    ).body[0]
    assert _reaches_a_supplier(raw_http, ""), "a raw httpx POST to a supplier must be seen"

    sdk = ast.parse(
        'async def leak2():\n'
        '    await client.chat.completions.create(model="x")\n'
    ).body[0]
    assert _reaches_a_supplier(sdk, ""), "an SDK completion call must be seen"

    stream = ast.parse(
        'async def leak3():\n'
        '    async with client.messages.stream(model="x") as s:\n'
        '        pass\n'
    ).body[0]
    assert _reaches_a_supplier(stream, ""), (
        "a streamed SDK call must be seen -- this is the shape that leaked"
    )

    clean = ast.parse(
        'def fine():\n'
        '    return db.query(Thing).all()\n'
    ).body[0]
    assert not _reaches_a_supplier(clean, ""), "ordinary code must not be flagged"
