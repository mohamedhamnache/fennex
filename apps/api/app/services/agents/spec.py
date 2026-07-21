import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.agents.brief import Brief


@dataclass
class AgentResult:
    ok: bool
    summary: str = ""
    content: Any = None
    artifact_type: Optional[str] = None
    artifact_ids: list[str] = field(default_factory=list)
    structured: dict = field(default_factory=dict)
    error: Optional[str] = None


@dataclass
class Skill:
    key: str
    agent_id: str
    weight: str                                   # "light" | "heavy"
    tools: list[str]
    build_prompt: Callable[["Brief", dict, dict], tuple[str, str]]
    output: str                                   # "json" | "markdown" | "text"
    parse: Optional[Callable[[str], Any]] = None
    label: str = ""
    description: str = ""
    # persist(result_content, campaign, brief, db) -> AgentResult   (optional artifact saver)
    persist: Optional[Callable[..., Awaitable["AgentResult"]]] = None
    max_tokens: Optional[int] = None              # override call_llm's token budget when set
