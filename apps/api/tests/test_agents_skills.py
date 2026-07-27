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


# --- feature -> policy band/ceiling: behavioural, not source-text -------------
#
# Each assertion below resolves the *actual* band and output-token ceiling a
# skill will run with -- the same functions runner.py and call_llm consult --
# rather than grepping for the string "feature=" in the module. A skill left
# unset must keep resolving to tier-only routing (None), not silently inherit
# some other feature's policy.

from app.services.agents.policy import policy_for
from app.services.agents.tiers import resolve_model
from app.services.llm_service import ARTICLE_MAX_TOKENS


def _effective_ceiling(skill) -> int:
    """What call_llm will actually cap output at for this skill: an explicit
    skill.max_tokens always wins over the policy (see runner.py's `mt`);
    otherwise the policy's cap applies when a feature is set, else the
    call_llm default."""
    if skill.max_tokens:
        return skill.max_tokens
    return policy_for(skill.feature).max_output_tokens


def test_write_article_resolves_to_the_standard_band_at_its_existing_ceiling():
    assert dune.WRITE_ARTICLE.feature == "article_draft"
    assert policy_for(dune.WRITE_ARTICLE.feature).band == "standard"
    # max_tokens was already ARTICLE_MAX_TOKENS; the policy's own cap is
    # identical, so naming the feature does not raise the ceiling.
    assert dune.WRITE_ARTICLE.max_tokens == ARTICLE_MAX_TOKENS
    assert policy_for(dune.WRITE_ARTICLE.feature).max_output_tokens == ARTICLE_MAX_TOKENS
    assert _effective_ceiling(dune.WRITE_ARTICLE) == ARTICLE_MAX_TOKENS
    assert resolve_model("max", "heavy", ["openai"], feature=dune.WRITE_ARTICLE.feature) == ("openai", "gpt-4o")


def test_generate_article_resolves_to_the_standard_band_at_its_existing_ceiling():
    assert dune.GENERATE_ARTICLE.feature == "article_draft"
    assert dune.GENERATE_ARTICLE.max_tokens == ARTICLE_MAX_TOKENS
    assert _effective_ceiling(dune.GENERATE_ARTICLE) == ARTICLE_MAX_TOKENS


def test_generate_visual_drops_to_the_cheap_image_prompt_ceiling():
    assert sirocco.GENERATE_VISUAL.feature == "image_prompt"
    assert policy_for(sirocco.GENERATE_VISUAL.feature).band == "cheap"
    # No max_tokens override existed, so the call previously ran at the 4096
    # default; the image_prompt cap (512) is strictly lower.
    assert sirocco.GENERATE_VISUAL.max_tokens is None
    assert _effective_ceiling(sirocco.GENERATE_VISUAL) == 512
    assert resolve_model("max", "heavy", ["openai"], feature=sirocco.GENERATE_VISUAL.feature) == ("openai", "gpt-4o-mini")


def test_product_shot_drops_to_the_cheap_image_prompt_ceiling():
    assert mirage.PRODUCT_SHOT.feature == "image_prompt"
    assert mirage.PRODUCT_SHOT.max_tokens is None
    assert _effective_ceiling(mirage.PRODUCT_SHOT) == 512


def test_competitor_scan_names_the_gap_feature_at_an_unchanged_ceiling():
    assert sable.COMPETITOR_SCAN.feature == "competitor_gap"
    assert policy_for(sable.COMPETITOR_SCAN.feature).band == "standard"
    # No max_tokens override existed (4096 default); competitor_gap's own cap
    # is also 4096, so this is unchanged, not a raise.
    assert sable.COMPETITOR_SCAN.max_tokens is None
    assert _effective_ceiling(sable.COMPETITOR_SCAN) == 4096


def test_skills_left_unset_still_route_on_tier_alone():
    """No existing policy key was an honest fit for these, so they must keep
    falling back to tier/weight routing (feature=None) rather than guess."""
    for skill in (dune.PRODUCT_COPY, sirocco.MULTI_NETWORK_SOCIAL, oasis.MARKET_REPORT,
                 oasis.DEFINE_ICP, nomad.OUTREACH_PLAN, nomad.TESTIMONIAL_CONTENT,
                 zerda.PICK_ANGLE):
        assert skill.feature is None, skill.key
