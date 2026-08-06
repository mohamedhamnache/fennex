"""The AI Router -- orchestration, not an employee.

The user types naturally into one chat. The Router reads the request, works out
what it actually requires, and hands the conversation to the best-qualified
employee. It never performs business work itself and it never names an employee
in its own code: selection is `Employee.confidence_score()` over the registry,
so an employee registered tomorrow competes for work on equal terms.

    understand()  message + history -> capabilities, complexity, tools
    select()      capabilities -> ranked candidates -> the owner
    route()       the whole decision, including single vs. team

Conversation ownership is sticky. Once an employee owns the thread it keeps it
until the work is done, another specialist is genuinely better, or the user
changes topic -- that is what stops a follow-up like "make it shorter" from
bouncing to someone new.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Optional

from app.employees import capabilities as caps
from app.employees import registry
from app.employees.spec import Employee

logger = logging.getLogger(__name__)

MODE_SINGLE = "single"
MODE_TEAM = "team"
MODE_CLARIFY = "clarify"
# The assistant answers in its own right, without waking a specialist.
MODE_ASSISTANT = "assistant"

# Below this, the Router is not confident enough to hand over silently.
MIN_CONFIDENCE = 0.30
# A challenger must beat the incumbent by this much to take over a live thread.
HANDOFF_MARGIN = 0.15
# Evidence needed to pull an ADDITIONAL specialist into a compound request on
# the keyword path. Deliberately high: a partial word overlap ("blog article"
# brushing against "article image") must not conscript the image artisan into
# a plain writing request. A near-complete phrase hit is required.
CONTRIBUTOR_FLOOR = 0.99

# The company's delivery pipeline. Work flows research -> decide -> create ->
# dress -> distribute, so a team is ordered by what each stage needs from the
# one before it rather than by the order the model happened to emit.
_STAGE_ORDER = {
    "research": 10,    # ground truth first
    "intel": 20,       # then the competitive picture
    "ecommerce": 25,   # what the store's own numbers say, before deciding
    "seo": 30,         # then the decision about what to make
    "content": 40,     # then the thing itself
    "copy": 45,
    "image": 50,       # visuals dress the finished content
    "campaign": 55,
    "social": 60,      # distribution last
    "outreach": 70,
    "publish": 80,
    "analytics": 90,   # measurement after the fact
}


def _stage(capability: str) -> int:
    return _STAGE_ORDER.get(capability.split(".", 1)[0], 50)


def order_capabilities(capabilities: list[str]) -> list[str]:
    """Sort into delivery order, keeping the first mention of each capability."""
    seen: list[str] = []
    for capability in capabilities:
        if capability not in seen:
            seen.append(capability)
    return sorted(seen, key=lambda c: (_stage(c), seen.index(c)))


@dataclass
class Intent:
    """What the Router understood, before anyone is chosen."""

    capabilities: list[str] = field(default_factory=list)
    complexity: str = "simple"            # "simple" | "complex"
    tools: list[str] = field(default_factory=list)
    summary: str = ""
    topic_changed: bool = False
    source: str = "llm"                   # "llm" | "keywords"

    def to_dict(self) -> dict:
        return {"capabilities": self.capabilities, "complexity": self.complexity,
                "tools": self.tools, "summary": self.summary,
                "topicChanged": self.topic_changed, "source": self.source}


@dataclass
class Candidate:
    employee: Employee
    confidence: float
    action_id: Optional[str] = None

    def to_dict(self) -> dict:
        return {"id": self.employee.id, "name": self.employee.name,
                "role": self.employee.role, "department": self.employee.department,
                "icon": self.employee.icon, "confidence": round(self.confidence, 3),
                "actionId": self.action_id}


@dataclass
class Decision:
    """Who takes the conversation, and why."""

    mode: str
    intent: Intent
    primary: Optional[Employee] = None
    action_id: Optional[str] = None
    candidates: list[Candidate] = field(default_factory=list)
    team: list[dict] = field(default_factory=list)     # [{capability, employee_id, action_id}]
    handoff_from: Optional[str] = None
    reason: str = ""

    @property
    def confidence(self) -> float:
        return self.candidates[0].confidence if self.candidates else 0.0

    def to_dict(self) -> dict:
        return {
            "mode": self.mode,
            "intent": self.intent.to_dict(),
            "primary": self.candidates[0].to_dict() if self.candidates else None,
            "actionId": self.action_id,
            "candidates": [c.to_dict() for c in self.candidates[:4]],
            "team": self.team,
            "handoffFrom": self.handoff_from,
            "reason": self.reason,
            "confidence": round(self.confidence, 3),
        }


# --- 1. understand ------------------------------------------------------------


async def understand(message: str, ctx, history: Optional[list[dict]] = None) -> Intent:
    """Turn a natural-language message into required capabilities.

    Falls back to keyword routing when no LLM key is configured, so the chat
    still works rather than failing closed.
    """
    known = sorted({c for e in registry.all_employees() for c in e.capabilities})
    providers = ctx.available_providers()
    if not providers:
        return _keyword_intent(message, known)

    from app.services.agents.tiers import resolve_model
    from app.services.llm_service import call_llm

    provider, model = resolve_model(ctx.tier, "light", providers)
    recent = _history_text(history)
    system = (
        "You are the router for a company of AI specialists. Read the user's MESSAGE and list "
        "every CAPABILITY that delivering it FULLY requires. Choose ONLY slugs from the "
        "CATALOG.\n\n"
        "DECOMPOSE COMPOUND REQUESTS. A request often names more than one deliverable, and "
        "missing one means the user does not get what they asked for. Every noun the user asks "
        "to receive is a separate capability:\n"
        '- "an article with a featured image" -> content.article AND image.editorial\n'
        '- "a blog post and share it on Instagram" -> content.article AND social.instagram\n'
        '- "product photos and the descriptions" -> image.product_photography AND '
        "content.product_description\n"
        '- "launch our new product" -> research, competitive check, angle, copy, visuals, social\n'
        "Do NOT collapse a compound request to its first deliverable.\n\n"
        "RETURN AN EMPTY LIST when the request is outside what this company does. Fennex does "
        "SEO, content, images, publishing and ecommerce analysis for a project. The weather, "
        "general knowledge, coding help, personal advice, current events -- none of these are "
        "work for anyone here, and naming a capability anyway hands a specialist a job it "
        "cannot do and makes it answer outside its competence. An empty list is a correct, "
        "useful answer: the assistant handles it.\n\n"

        "Also judge:\n"
        '- "topicChanged": true if the MESSAGE moves away from what RECENT was about.\n'
        '- "summary": one short line naming the deliverable(s).\n'
        'Respond with ONLY JSON: {"capabilities": [...], "topicChanged": bool, '
        '"summary": "..."}.\n\n'
        f"CATALOG:\n{caps.catalog_text(known)}"
    )
    user = f"MESSAGE: {message}"
    if recent:
        user += f"\n\nRECENT:\n{recent}"

    try:
        raw = await call_llm(provider, model, ctx.keys[provider], system, user,
                             locale=ctx.locale, feature="classification")
        parsed = json.loads(re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip()))
        wanted = order_capabilities(
            [c for c in parsed.get("capabilities", []) if c in known])[:8]
        if not wanted:
            return _keyword_intent(message, known)
        # Complexity is derived from the work, never self-reported: if the
        # capabilities need two different specialists, it is collaboration.
        distinct = {registry.resolve_action(c)[0].id
                    for c in wanted if registry.resolve_action(c)[0] is not None}
        return Intent(
            capabilities=wanted,
            complexity="complex" if len(distinct) > 1 else "simple",
            tools=_tools_for(wanted),
            summary=str(parsed.get("summary", ""))[:200],
            topic_changed=bool(parsed.get("topicChanged", False)),
            source="llm",
        )
    except Exception:
        logger.exception("router intent failed; falling back to keywords")
        return _keyword_intent(message, known)


# A second deliverable is signalled by the user joining two asks together.
# Without one of these, a request is treated as a single ask no matter how many
# specialists could plausibly claim a word in it.
_COMPOUND_MARKERS = (" and ", " with ", " plus ", " then ", " also ", ",",
                     " et ", " avec ", " y ", " con ", " und ", " mit ", " e ")


def _evidence(employee, message: str) -> float:
    """How strongly this message asks for what this employee does.

    Two independent signals, whichever is stronger: the employee's declared
    task phrases, and the vocabulary of its best-matching action. The second
    matters because a user rarely echoes a task phrase verbatim -- "create an
    article" does not match the phrase "write an article", but it does match
    the `content.article` capability behind it.
    """
    from app.employees.spec import _phrase_match

    phrase = _phrase_match(message, employee.supported_tasks)
    action = _best_action(employee, message)
    vocabulary = 0.0
    if action is not None:
        terms = [action.label] + [
            c.split(".", 1)[-1].replace("_", " ") for c in action.capabilities]
        vocabulary = _phrase_match(message, terms)
    return max(phrase, vocabulary)


# Messages that ask nothing of the company. Routing these to a specialist is
# how "how are you" reached the Market Researcher at 0.69 confidence: the
# keyword fallback scores phrase overlap against `supported_tasks`, and a
# greeting brushes against enough words to look like work. Small talk and
# questions ABOUT Fennex are answered by Fennex.
_SMALL_TALK = re.compile(
    r"^\s*(?:"
    r"h(?:i|ey|ello|allo)|salut|bonjour|bonsoir|coucou|hola|ol[aá]|hallo|"
    r"thanks?|thank you|merci|gracias|danke|obrigad[oa]|"
    r"ok(?:ay)?|d'accord|super|parfait|nice|cool|bye|au revoir|"
    r"(?:how are you|how's it going|ça va|comment (?:ça )?vas?[- ]tu|qui es[- ]tu|"
    r"who are you|what (?:can|do) you do|que (?:peux|sais)[- ]tu faire|"
    r"what are you|aide|help)"
    r")\b[\s!?.,;:]*$",
    re.IGNORECASE)


def is_small_talk(message: str) -> bool:
    """A greeting, a thank-you, or a question about Fennex itself.

    Deliberately anchored to the whole message: "hello" is small talk, but
    "hello, write me an article about running shoes" is work, and a loose
    substring match would swallow the second.
    """
    text = (message or "").strip()
    # A long message is doing something even if it opens with a greeting.
    return len(text) <= 60 and bool(_SMALL_TALK.match(text))


def _keyword_intent(message: str, known: list[str]) -> Intent:
    """No-LLM fallback: let the employees themselves vote on the raw wording.

    The strongest match always leads. Additional specialists join only when the
    message actually joins two asks together ("an article WITH a featured
    image") and they own a different stage of delivery -- so a compound request
    reaches everyone it needs without a plain one conscripting the whole
    company. Entirely name-free.
    """
    scored = [(_evidence(e, message), e) for e in registry.all_employees()]
    scored = [(s, e) for s, e in scored if s > 0]
    if not scored:
        return Intent(capabilities=[], complexity="simple", summary=message[:200],
                      source="keywords")
    scored.sort(key=lambda pair: -pair[0])

    lowered = f" {message.lower()} "
    compound = any(marker in lowered for marker in _COMPOUND_MARKERS)

    chosen: list[object] = [scored[0][1]]
    stages = {_stage(_primary_capability(scored[0][1], message) or "")}
    if compound:
        for evidence, employee in scored[1:]:
            if evidence < CONTRIBUTOR_FLOOR:
                continue
            capability = _primary_capability(employee, message)
            if capability is None or _stage(capability) in stages:
                continue
            chosen.append(employee)
            stages.add(_stage(capability))

    wanted: list[str] = []
    for employee in chosen:
        capability = _primary_capability(employee, message)
        if capability and capability in known and capability not in wanted:
            wanted.append(capability)

    wanted = order_capabilities(wanted)
    distinct = {registry.resolve_action(c)[0].id
                for c in wanted if registry.resolve_action(c)[0] is not None}
    return Intent(capabilities=wanted,
                  complexity="complex" if len(distinct) > 1 else "simple",
                  tools=_tools_for(wanted), summary=message[:200], source="keywords")


def _primary_capability(employee, message: str) -> Optional[str]:
    action = _best_action(employee, message)
    if action is not None and action.capabilities:
        return action.capabilities[0]
    return employee.capabilities[0] if employee.capabilities else None


# A quoted span is the user telling us the subject verbatim -- the single most
# reliable signal there is, and it must survive intact into the title.
_QUOTED_RE = re.compile(
    r'[“”«»"‘’\']\s*(.{4,160}?)\s*'
    r'[“”«»"‘’\']')

# Leading instructions to strip when no quoted subject is given, so
# "crée un article sur X avec une image" reduces to "X".
# Longer alternatives must come first throughout: regex alternation takes the
# first match, so "a" before "an" would leave a stray "n" on "an article".
_DETERMINER = r"(?:une|un|les|le|la|des|du|some|the|an|a)"

_LEAD_RE = re.compile(
    r"^\s*(?:please\s+|s'?il\s+vous\s+pla[iî]t\s+)?"
    r"(?:cr[ée]{1,2}e?z?|r[ée]dige[sz]?|[ée]cri[sz]?|g[ée]n[èe]re[sz]?|fai[ts]|"
    r"write|create|draft|generate|make|produce|prepare|build)\s+"
    r"(?:me\s+|moi\s+|us\s+|nous\s+)?"
    rf"{_DETERMINER}?\s*"
    r"(?:nouvel|nouveau|new)?\s*"
    # Qualifiers that sit between the determiner and the noun ("an SEO article").
    r"(?:seo|long[-\s]?form|in[-\s]?depth|detailed|complete|short|"
    r"d[ée]taill[ée]?|complet|court|long|optimis[ée]?)?\s*"
    r"(?:articles?|blog\s*posts?|posts?|billets?|pages?|papiers?|pieces?)?\s*"
    r"(?:de\s+blog\s*)?"
    r"(?:au\s+sujet\s+de|concernant|about|sur|on|pour)?\s*",
    re.IGNORECASE)

# Trailing add-ons that are a separate deliverable, not part of the subject.
# The conjunction may be followed by its own verb ("et génère une image").
_TRAILING_RE = re.compile(
    r"\s*(?:,\s*)?(?:et|and|with|avec|plus|\+)\s*"
    r"(?:g[ée]n[èe]re[sz]?|cr[ée]{1,2}e?z?|ajoute[sz]?|add|include|inclus|"
    r"generate|create|make)?\s*"
    rf"{_DETERMINER}?\s*"
    r"(?:featured|cover|hero|editorial|en\s+vedette|mise\s+en\s+avant)?\s*"
    r"(?:images?|photos?|visuels?|visuals?|illustrations?|pictures?|"
    r"couvertures?|covers?)\b.*$",
    re.IGNORECASE)


def quoted_subject(message: str) -> Optional[str]:
    """The subject the user put in quotes, if any."""
    match = _QUOTED_RE.search(message or "")
    if not match:
        return None
    subject = match.group(1).strip(" .:-—–")
    return subject if len(subject) >= 4 else None


def strip_instruction(message: str) -> str:
    """Reduce a request to its subject when nothing is quoted."""
    text = (message or "").strip()
    text = _TRAILING_RE.sub("", text)
    text = _LEAD_RE.sub("", text)
    return text.strip(" .:-—–\"'").strip()


async def extract_brief(message: str, ctx, intent: Optional[Intent] = None) -> dict:
    """Turn the request into the brief the specialists actually need.

    Without this, a writer receives the raw sentence as its title -- which is
    how "Crée un article "X" avec une image" ended up titled with the whole
    instruction. A quoted subject is taken verbatim; otherwise the instruction
    is stripped, and an LLM refines it into a title and primary keyword.
    """
    quoted = quoted_subject(message)
    stripped = strip_instruction(message)
    topic = quoted or stripped or (message or "").strip()

    brief = {"topic": topic, "title": topic, "keyword": topic,
             "rationale": "", "source": "quoted" if quoted else "stripped"}

    providers = ctx.available_providers()
    if not providers or not topic:
        return brief

    from app.services.agents.tiers import resolve_model
    from app.services.llm_service import call_llm

    provider, model = resolve_model(ctx.tier, "light", providers)
    system = (
        "You turn a user's request into a content brief. Return ONLY JSON:\n"
        '{"title": "...", "keyword": "...", "rationale": "..."}\n\n'
        "RULES:\n"
        "- title: the finished piece's headline. Write it in the SAME LANGUAGE as the request. "
        "If the user already gave a title (often in quotes), keep it essentially as-is -- do not "
        "restate their instruction, and never include words like 'write an article about'.\n"
        "- keyword: the single primary search keyword, 2-5 words, lowercase, no quotes.\n"
        "- rationale: one sentence on the angle worth taking.\n"
        "- Mention nothing about images or other deliverables; the title is about the text only."
    )
    user = f"REQUEST: {message}\nSUBJECT DETECTED: {topic}"
    if ctx.dna.project_profile:
        user += f"\nPROJECT: {ctx.dna.project_profile[:400]}"

    try:
        raw = await call_llm(provider, model, ctx.keys[provider], system, user,
                             locale=ctx.locale)
        parsed = json.loads(re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip()))
        title = str(parsed.get("title") or "").strip()
        keyword = str(parsed.get("keyword") or "").strip()
        # A quoted title is the user's own wording -- never let the model
        # overwrite it, only fill in what was missing.
        if quoted:
            title = quoted
        if title:
            brief["title"] = brief["topic"] = title[:200]
        if keyword:
            brief["keyword"] = keyword[:120]
        brief["rationale"] = str(parsed.get("rationale") or "")[:400]
        brief["source"] = "llm" if not quoted else "quoted+llm"
    except Exception:
        logger.exception("brief extraction failed; using the stripped subject")
    return brief


def _best_action(employee, message: str):
    """Which of this employee's actions the message is actually asking for.

    Matched on the action's own label and the leaf words of its capabilities,
    so "a featured image" reaches the editorial action rather than whichever
    action happens to be declared first.
    """
    from app.employees.spec import _phrase_match

    if not employee.actions:
        return None
    best, best_score = employee.actions[0], -1.0
    for action in employee.actions:
        vocabulary = [action.label] + [
            c.split(".", 1)[-1].replace("_", " ") for c in action.capabilities]
        score = _phrase_match(message, vocabulary)
        if score > best_score:
            best, best_score = action, score
    return best


def _tools_for(capabilities: list[str]) -> list[str]:
    """Which tools the chosen work is likely to need -- surfaced so the UI can
    warn about a disconnected app before anything runs."""
    tools: list[str] = []
    for capability in capabilities:
        employee, action = registry.resolve_action(capability)
        if employee is None:
            continue
        for tool in employee.allowed_tools:
            if tool not in tools:
                tools.append(tool)
    return tools


def _history_text(history: Optional[list[dict]], limit: int = 6) -> str:
    if not history:
        return ""
    lines = []
    for turn in history[-limit:]:
        role = turn.get("role", "user")
        who = turn.get("employeeId") or role
        content = str(turn.get("content", ""))[:300]
        if content:
            lines.append(f"{who}: {content}")
    return "\n".join(lines)


# --- 2. select ----------------------------------------------------------------


def rank(message: str, intent: Intent, *, current_owner: Optional[str] = None) -> list[Candidate]:
    """Every employee scores itself; the Router only sorts."""
    out: list[Candidate] = []
    for employee in registry.all_employees():
        confidence = employee.confidence_score(
            message, intent.capabilities, is_current_owner=(employee.id == current_owner))
        if confidence <= 0:
            continue
        action_id = None
        for capability in intent.capabilities:
            actions = employee.actions_for(capability)
            if actions:
                action_id = actions[0].id
                break
        if action_id is None and employee.actions:
            action_id = employee.actions[0].id
        out.append(Candidate(employee=employee, confidence=confidence, action_id=action_id))
    out.sort(key=lambda c: (-c.confidence, -c.employee.priority))
    return out


def build_team(intent: Intent) -> list[dict]:
    """Assign each required capability to whoever can actually act on it.

    Ordered by delivery stage, and de-duplicated per (employee, action): asking
    for two kinds of social copy is still one pass by the creative director,
    not two.
    """
    team: list[dict] = []
    taken: set[tuple[str, str]] = set()
    for capability in order_capabilities(intent.capabilities):
        employee, action = registry.resolve_action(capability)
        if employee is None or action is None:
            continue
        if (employee.id, action.id) in taken:
            continue
        taken.add((employee.id, action.id))
        team.append({"capability": capability, "employeeId": employee.id,
                     "employeeName": employee.name, "actionId": action.id,
                     "icon": employee.icon, "department": employee.department})
    return team


def next_steps(employee_id: str, done_capabilities: list[str],
               limit: int = 3) -> list[dict]:
    """What the company would naturally do next after this employee finishes.

    Read from the employee's own `produces_for` declaration, so the suggested
    follow-up ("now the featured image") comes from the roster rather than from
    anything hardcoded here. Used to offer the next specialist as a button.
    """
    employee = registry.get(employee_id)
    if employee is None:
        return []
    done = set(done_capabilities or [])
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for capability in employee.produces_for:
        if capability in done:
            continue
        nxt, action = registry.resolve_action(capability)
        if nxt is None or action is None or nxt.id == employee_id:
            continue
        if (nxt.id, action.id) in seen:
            continue
        seen.add((nxt.id, action.id))
        out.append({"capability": capability, "employeeId": nxt.id,
                    "employeeName": nxt.name, "actionId": action.id,
                    "label": action.label, "description": action.description,
                    "icon": nxt.icon, "department": nxt.department})
    return out[:limit]


# --- 3. route -----------------------------------------------------------------


async def route(message: str, ctx, *, history: Optional[list[dict]] = None,
                current_owner: Optional[str] = None) -> Decision:
    """The whole decision: understand, rank, and decide who takes the thread."""
    # Before anything is understood or ranked: a greeting is not work. Checked
    # first so it costs no router call at all -- the cheapest answer to "hello"
    # is the one that never reaches a model to classify it.
    if is_small_talk(message):
        return Decision(mode=MODE_ASSISTANT, intent=Intent(summary=message[:200],
                                                           source="smalltalk"),
                        reason="Conversational message -- Fennex answers directly.")

    intent = await understand(message, ctx, history)
    if not intent.capabilities and intent.source == "llm":
        # The router looked and found no work here. Only trusted from the LLM
        # path: the keyword fallback returns nothing whenever it simply fails
        # to match, which is a different statement entirely.
        return Decision(mode=MODE_ASSISTANT, intent=intent,
                        reason="Outside what the company does -- Fennex answers.")

    candidates = rank(message, intent, current_owner=current_owner)

    if not candidates or candidates[0].confidence < MIN_CONFIDENCE:
        # An ambiguous message is not necessarily an unroutable one. "Make it
        # shorter" means nothing on its own, but it is obviously still for
        # whoever is holding the thread -- continuity resolves it, and only a
        # cold start with no owner genuinely needs a clarifying question.
        owner = registry.get(current_owner) if current_owner else None
        if owner is not None and not intent.topic_changed:
            return Decision(
                mode=MODE_SINGLE, intent=intent, primary=owner,
                action_id=(owner.actions[0].id if owner.actions else None),
                candidates=[Candidate(employee=owner, confidence=MIN_CONFIDENCE,
                                      action_id=(owner.actions[0].id if owner.actions else None))],
                reason=f"Follow-up: {owner.name} still owns this conversation.")
        return Decision(mode=MODE_CLARIFY, intent=intent, candidates=candidates,
                        reason="No employee is confident enough to take this on.")

    # Collaboration: whenever the work genuinely needs more than one specialist.
    # This is decided by who can actually do the work, not by a complexity
    # label -- a request for "an article with a featured image" needs two
    # people whether or not anything called it complex.
    team = build_team(intent)
    distinct = {step["employeeId"] for step in team}
    if len(distinct) > 1:
        lead = registry.get(team[0]["employeeId"])
        return Decision(
            mode=MODE_TEAM, intent=intent, primary=lead,
            action_id=team[0]["actionId"], candidates=candidates, team=team,
            reason=f"{len(distinct)} specialists are needed for this.")

    winner = candidates[0]

    # Ownership is sticky: the incumbent keeps the thread unless a challenger is
    # clearly better, so follow-ups stay with whoever is already doing the work.
    handoff_from = None
    if current_owner and winner.employee.id != current_owner:
        incumbent = next((c for c in candidates if c.employee.id == current_owner), None)
        if (incumbent is not None and not intent.topic_changed
                and winner.confidence - incumbent.confidence < HANDOFF_MARGIN):
            winner = incumbent
        else:
            handoff_from = current_owner

    return Decision(
        mode=MODE_SINGLE, intent=intent, primary=winner.employee,
        action_id=winner.action_id, candidates=candidates, handoff_from=handoff_from,
        reason=(f"{winner.employee.name} is the strongest match "
                f"({winner.confidence:.0%} confidence)."),
    )
