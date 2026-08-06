"""Revenue attribution: which article an order can honestly be traced to.

The join that turns "400 clicks" into "2,300 earned". Everything here guards
the two ways it can lie: crediting content for a sale that did not start there,
and dropping a sale that did.
"""
import uuid

from app.services.store_revenue_service import attribute, normalise_path

ARTICLE = uuid.uuid4()
PATHS = {"/blog/best-boots": ARTICLE, "/": uuid.uuid4()}


def test_campaign_parameters_do_not_break_the_match():
    """landing_site routinely carries ?utm_source=...; a published URL never
    does. Comparing raw strings would match almost nothing."""
    got, path = attribute(
        "https://shop.example.com/blog/best-boots?utm_source=newsletter&utm_id=9",
        "web", PATHS)
    assert got == ARTICLE
    assert path == "/blog/best-boots"


def test_trailing_slash_and_case_do_not_break_the_match():
    assert attribute("https://shop.example.com/Blog/Best-Boots/", "web", PATHS)[0] == ARTICLE


def test_an_unmatched_landing_page_keeps_its_path():
    """Not attributing is a normal outcome -- most sales do not start on an
    article. Keeping the path is what makes "why not?" answerable instead of
    merely doubted."""
    got, path = attribute("https://shop.example.com/collections/sale", "web", PATHS)
    assert got is None
    assert path == "/collections/sale"


def test_point_of_sale_can_never_be_attributed_to_content():
    """A till sale had no landing page. Counting it would inflate content
    revenue with in-person trade -- the failure that would quietly make every
    number in the feature wrong."""
    for source in ("pos", "POS", "draft_order", "iphone"):
        got, path = attribute("https://shop.example.com/blog/best-boots", source, PATHS)
        assert got is None, f"{source} must not attribute"
        assert path is None


def test_an_order_with_no_landing_site_attributes_to_nothing():
    assert attribute(None, "web", PATHS) == (None, None)
    assert attribute("", "web", PATHS) == (None, None)


def test_normalise_path_is_stable_on_the_shapes_shopify_sends():
    assert normalise_path("https://a.com/x/y") == "/x/y"
    assert normalise_path("https://a.com/x/y/") == "/x/y"
    assert normalise_path("https://a.com") == "/"
    assert normalise_path("/x/y?z=1") == "/x/y"
    assert normalise_path(None) is None


def test_a_different_path_does_not_borrow_another_articles_credit():
    """The prefix trap: /blog/best-boots-review is a DIFFERENT article and must
    not inherit the match from /blog/best-boots."""
    got, _ = attribute("https://shop.example.com/blog/best-boots-review", "web", PATHS)
    assert got is None
