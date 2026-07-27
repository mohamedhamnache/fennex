"""Guard for the Phase 1a regression: a catalogued model with no cost_rates row
prices to $0 and silently destroys the margin math. Every model in the catalog
seed must have interactive and batch rates in the migrations."""
import pathlib
import re

from app.services.providers.catalog import SEED

VERSIONS = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions"

_ROW = re.compile(r"\(\s*'([a-z]+)'\s*,\s*'([a-z_]+)'\s*,\s*'([^']+)'\s*,\s*([0-9.]+)\s*\)")

REQUIRED_UNITS = (
    "input_token", "output_token", "cache_read_token",
    "batch_input_token", "batch_output_token", "batch_cache_read_token",
)


def _seeded_rates() -> set[tuple[str, str, str]]:
    seeded = set()
    for path in VERSIONS.glob("*.py"):
        text = path.read_text()
        for block in re.findall(r"INSERT INTO cost_rates.*?\"\"\"", text, re.S):
            for provider, unit, model, _value in _ROW.findall(block):
                seeded.add((provider, unit, model))
    return seeded


def test_every_catalogued_model_is_priced_for_every_unit():
    seeded = _seeded_rates()
    missing = [
        (provider, unit, model)
        for _band, provider, model, _priority, _supports in SEED
        for unit in REQUIRED_UNITS
        if (provider, unit, model) not in seeded
    ]
    assert missing == [], f"catalogued models without a cost_rate: {missing}"
