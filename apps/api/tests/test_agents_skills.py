import uuid, json
from app.services.agents.brief import Brief
from app.services.agents.skills import zerda
from app.services.agents.skills._common import brief_block, feedback_block, parse_json


def _brief(existing=None):
    return Brief(goal="Rank for vegan protein", persona="creator", project_id=uuid.uuid4(),
                 org_id=uuid.uuid4(), locale="en", project_profile="A vegan nutrition blog",
                 brand={"tone": "friendly", "avoid_words": ["cheap"]},
                 existing_content=existing or ["Best vegan protein powders"], artifacts=[])


def test_brief_block_includes_goal_and_dedup():
    txt = brief_block(_brief())
    assert "Rank for vegan protein" in txt and "Best vegan protein powders" in txt and "friendly" in txt


def test_feedback_block_present_only_when_feedback():
    assert feedback_block({}) == ""
    assert "FIX THIS" in feedback_block({"feedback": "too generic"})


def test_pick_angle_prompt_is_goal_first_and_dedup_aware():
    td = {"gsc_opportunities": {"ok": True, "data": {"queries": [{"query": "vegan protein for runners",
          "position": 8.1, "potential": 40}]}}, "market_insights": {"ok": True, "data": {"clusters": [], "ideas": []}}}
    system, user = zerda.PICK_ANGLE.build_prompt(_brief(), {}, td)
    assert "Rank for vegan protein" in user
    assert "Best vegan protein powders" in user            # dedup list present
    assert "vegan protein for runners" in user             # opportunity keyword present
    assert zerda.PICK_ANGLE.output == "json"


def test_pick_angle_parses_json_with_fences():
    assert parse_json('```json\n{"topic":"X"}\n```') == {"topic": "X"}


from app.services.agents.skills import dune


def test_write_article_prompt_includes_angle_and_feedback():
    b = _brief()
    inputs = {"angle": "Vegan protein for marathon runners", "keyword": "vegan protein runners",
              "rationale": "Targets an underserved athlete niche", "feedback": "Add training-load specifics"}
    system, user = dune.WRITE_ARTICLE.build_prompt(b, inputs, {})
    assert "Vegan protein for marathon runners" in user
    assert "Targets an underserved athlete niche" in user
    assert "FIX THIS" in user
    assert dune.WRITE_ARTICLE.output == "markdown" and dune.WRITE_ARTICLE.persist is not None


def test_product_copy_prompt_and_output():
    system, user = dune.PRODUCT_COPY.build_prompt(_brief(), {"product": {"title": "Serum", "price": "19"}}, {})
    assert "Serum" in user and dune.PRODUCT_COPY.output == "json"
