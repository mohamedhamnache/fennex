"""Brief extraction: the subject a specialist actually works from.

Regression guard for the reported failure -- 'Crée un article "X" avec une
image' produced an article titled with the whole instruction, 43 words long,
and an image unrelated to the subject.
"""

import pytest

from app.employees.router import quoted_subject, strip_instruction


# --- quoted subjects are taken verbatim ---------------------------------------


@pytest.mark.parametrize("message,expected", [
    ('Crée un article "Comment remplacer les oeufs dans la cuisine" avec une image',
     "Comment remplacer les oeufs dans la cuisine"),
    ('Create a blog post "The 3:2:1 lemonade ratio"', "The 3:2:1 lemonade ratio"),
    ('Write an article “Egg substitutes that actually work”',
     "Egg substitutes that actually work"),
])
def test_a_quoted_title_is_kept_exactly(message, expected):
    assert quoted_subject(message) == expected


def test_no_quotes_means_no_quoted_subject():
    assert quoted_subject("Write an article about lemonade") is None
    assert quoted_subject("") is None


# --- unquoted requests are reduced to their subject ---------------------------


@pytest.mark.parametrize("message,expected", [
    ("Write an article about homemade lemonade with a featured image",
     "homemade lemonade"),
    ("Write an SEO article about homemade lemonade", "homemade lemonade"),
    ("Rédige un article sur la limonade maison", "la limonade maison"),
    ("écris un article de blog sur les substituts d oeufs et génère une image",
     "les substituts d oeufs"),
    ("Create a blog post about egg substitutes and generate images",
     "egg substitutes"),
])
def test_the_instruction_is_stripped_down_to_the_subject(message, expected):
    assert strip_instruction(message) == expected


def test_the_determiner_is_not_half_eaten():
    """'a' must not match inside 'an', leaving a stray letter on the subject."""
    assert not strip_instruction(
        "Write an article about lemonade").startswith("n ")


def test_a_trailing_image_request_is_not_part_of_the_subject():
    for message in (
        "Write an article about lemonade with a featured image",
        "Write an article about lemonade and generate a cover image",
        "Rédige un article sur la limonade et génère une image",
    ):
        assert "image" not in strip_instruction(message).lower()


def test_a_bare_subject_survives_untouched():
    assert strip_instruction("homemade lemonade") == "homemade lemonade"


# --- the writer receives a real brief -----------------------------------------


def test_the_article_skill_prefers_the_brief_title_over_the_raw_goal():
    """The reported bug: with no inputs the title fell back to the whole prompt."""
    from app.services.agents.skills.dune import _write_article_prompt

    class _Brief:
        goal = 'Crée un article "Comment remplacer les oeufs" avec une image'
        project_profile = ""
        brand = {}
        locale = "fr"

    _system, user = _write_article_prompt(
        _Brief(), {"title": "Comment remplacer les oeufs dans la cuisine",
                   "keyword": "remplacer les oeufs"}, {})
    assert "Comment remplacer les oeufs dans la cuisine" in user
    assert "Crée un article" not in user.split("CAMPAIGN CONTEXT")[0]


def test_the_article_skill_has_room_for_a_full_draft():
    """Without an explicit budget it inherited 4096 tokens and got truncated."""
    from app.services.agents.skills.dune import WRITE_ARTICLE
    from app.services.llm_service import ARTICLE_MAX_TOKENS

    assert WRITE_ARTICLE.max_tokens == ARTICLE_MAX_TOKENS


def test_the_visual_skill_uses_the_topic_it_is_given():
    """The featured image must follow the article, not the raw instruction."""
    from app.services.agents.skills.sirocco import _visual_prompt

    class _Brief:
        goal = "Crée un article avec une image"
        persona = "creator"
        project_profile = ""
        brand = {}
        existing_content = []
        artifacts = []
        locale = "fr"

    _system, user = _visual_prompt(
        _Brief(), {"topic": "Comment remplacer les oeufs dans la cuisine"}, {})
    assert "Comment remplacer les oeufs dans la cuisine" in user
