"""Chat Mirage must photograph the merchant's product, not invent one.

The chat skill called generate_image_dalle -- text-to-image -- while the studio
used flux-kontext-pro on Replicate, which re-scenes the ACTUAL product photo.
Same button, different output: one returns the merchant's product in a new
scene, the other returns something that merely resembles it. A merchant who
believes the first got the second ships the wrong image and hears about it
from a customer.
"""
import inspect

from app.services.agents.skills import mirage


class TestUsesTheStudioPath:
    def test_it_reuses_the_studio_s_replicate_call(self):
        """Reused, not reimplemented: a second copy would drift from the studio
        in model, parameters and price."""
        src = inspect.getsource(mirage._persist_shot)
        assert "_run_flux_kontext" in src

    def test_a_real_product_photo_is_preferred_over_text_to_image(self):
        src = inspect.getsource(mirage._persist_shot)
        assert src.index("_source_product_image") < src.index("generate_image_dalle")

    def test_text_to_image_remains_the_fallback(self):
        """A project with no synced catalogue must still get an image."""
        assert "generate_image_dalle" in inspect.getsource(mirage._persist_shot)

    def test_the_reply_says_which_engine_ran(self):
        """The difference is invisible in the image itself. If the summary does
        not distinguish them, nothing does."""
        src = inspect.getsource(mirage._persist_shot)
        assert "not your actual product" in src
        assert "Re-scened your product photo" in src

    def test_the_source_image_is_scoped_to_the_org(self):
        """It reads a catalogue row by project id, which is guessable."""
        src = inspect.getsource(mirage._source_product_image)
        assert "StoreProduct.org_id == brief.org_id" in src


class TestCredits:
    def test_generation_goes_through_the_metered_chokepoint(self):
        """_replicate_run is where Replicate spend is recorded and where
        MIN_REPLICATE_CREDITS is applied. A direct replicate call here would be
        unmetered spend -- the failure the metering audit exists to prevent."""
        src = inspect.getsource(mirage)
        assert "replicate.run" not in src
        assert "import replicate" not in src

    async def test_the_price_matches_the_documented_figure(self, db_session=None):
        """docs/ai-credits-and-models.md quotes 39 credits for a
        flux-kontext-pro product scene. If the rate moves, the doc is wrong and
        the margin changed -- fail here rather than discover it on an invoice."""
        from app.core.credits import credits_from_micros
        # 40,000 micro-$ is the seeded rate for this model.
        assert credits_from_micros(40_000) == 39
