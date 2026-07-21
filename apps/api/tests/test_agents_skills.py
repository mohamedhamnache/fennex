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


from app.services.agents.skills import sirocco, oasis, sable, nomad, mirage


def test_multi_network_social_prompt_lists_platforms():
    inp = {"topic": "Summer serum launch", "platforms": ["linkedin", "instagram"]}
    system, user = sirocco.MULTI_NETWORK_SOCIAL.build_prompt(_brief(), inp, {})
    assert "linkedin" in user and "instagram" in user and sirocco.MULTI_NETWORK_SOCIAL.output == "json"


def test_generate_visual_is_two_step_with_persist():
    system, user = sirocco.GENERATE_VISUAL.build_prompt(_brief(), {"topic": "serum"}, {})
    assert "NO text" in system or "no text" in system.lower()
    assert sirocco.GENERATE_VISUAL.persist is not None and sirocco.GENERATE_VISUAL.output == "text"


def test_market_report_is_markdown_and_icp_is_json():
    assert oasis.MARKET_REPORT.output == "markdown"
    assert oasis.DEFINE_ICP.output == "json"


def test_outreach_and_testimonial_outputs():
    assert nomad.OUTREACH_PLAN.output == "json" and nomad.TESTIMONIAL_CONTENT.output == "json"


def test_competitor_scan_reads_url_input():
    td = {"crawl_competitor": {"ok": True, "data": {"analysis": {"url": "x.com", "scorecard": {"score": 60}}}}}
    system, user = sable.COMPETITOR_SCAN.build_prompt(_brief(), {"competitor_url": "x.com"}, td)
    assert "x.com" in user and sable.COMPETITOR_SCAN.output == "json"


from app.services.agents.registry import SKILLS, get_skill, catalog_text


def test_registry_contains_all_core_skills():
    for key in ["zerda.pick_angle", "zerda.keyword_targets", "dune.write_article", "dune.product_copy",
                "sirocco.multi_network_social", "sirocco.generate_visual", "oasis.market_report",
                "oasis.define_icp", "sable.competitor_scan", "mirage.product_shot",
                "nomad.outreach_plan", "nomad.testimonial_content"]:
        assert key in SKILLS, key
    assert get_skill("dune.write_article").agent_id == "dune"
    assert get_skill("nope") is None


def test_catalog_text_lists_keys_and_agents():
    txt = catalog_text()
    assert "zerda.pick_angle (zerda" in txt and "dune.write_article (dune" in txt


def test_multi_network_social_prompt_requests_hooks():
    system, user = sirocco.MULTI_NETWORK_SOCIAL.build_prompt(_brief(), {"topic": "t", "platforms": ["linkedin"]}, {})
    assert "hooks" in system.lower()
