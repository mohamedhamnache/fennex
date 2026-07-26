"""The policy map only bites where callers name their feature. These are the
highest-volume paths; a call site without a feature silently falls back to the
tier band and skips its output cap."""
import inspect

from app.services import discovery_service, knowledge_service
from app.services.agents import director, reviewer, runner


def _source(obj) -> str:
    return inspect.getsource(obj)


def test_discovery_names_its_feature():
    assert 'feature="discovery"' in _source(discovery_service)


def test_agent_paths_pass_the_skill_feature_through():
    for module in (runner, director, reviewer):
        source = _source(module)
        assert "feature=" in source, module.__name__


def test_knowledge_service_names_its_feature():
    assert "feature=" in _source(knowledge_service)
