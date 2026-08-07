"""One-click connection, and the signature that makes it safe.

The callback arrives from the provider with no auth header of ours, so the
STATE is the only thing saying which organisation the token belongs to. If it
could be forged or replayed, an attacker could have a victim's authorisation
stored against the attacker's org -- or their own workspace attached to someone
else's Fennex. Everything here defends that one property.
"""
import time
import uuid

import pytest

from app.services import connector_oauth as oauth

ORG = uuid.uuid4()
PROJECT = uuid.uuid4()


class TestState:
    def test_a_round_trip_returns_the_org_and_project(self):
        claims = oauth.read_state(oauth.make_state(ORG, PROJECT))
        assert claims is not None
        assert claims["o"] == str(ORG)
        assert claims["p"] == str(PROJECT)

    def test_a_tampered_payload_is_rejected(self):
        """The whole point: swapping the org in the payload must not verify."""
        state = oauth.make_state(ORG, PROJECT)
        encoded, _, signature = state.partition(".")
        forged = oauth.make_state(uuid.uuid4(), PROJECT).partition(".")[0]
        assert oauth.read_state(f"{forged}.{signature}") is None

    def test_an_unsigned_state_is_rejected(self):
        import base64, json
        body = json.dumps({"o": str(ORG), "p": None, "n": "x", "t": int(time.time())}).encode()
        encoded = base64.urlsafe_b64encode(body).decode().rstrip("=")
        assert oauth.read_state(encoded) is None
        assert oauth.read_state(f"{encoded}.") is None
        assert oauth.read_state(f"{encoded}.notasignature") is None

    def test_an_expired_state_is_rejected(self, monkeypatch):
        """A captured state must be worthless by the time anyone finds it.

        The state is minted now and read from a future far enough past the TTL
        that it must not verify. monkeypatch restores the clock even if the
        assertion fails -- a leaked patched time() would break every later
        test in the session.
        """
        state = oauth.make_state(ORG, PROJECT)
        assert oauth.read_state(state) is not None      # valid right now

        real_time = time.time
        monkeypatch.setattr(oauth.time, "time",
                            lambda: real_time() + oauth.STATE_TTL_SECONDS + 60)
        assert oauth.read_state(state) is None

    def test_two_states_are_never_equal(self):
        """A nonce, so an identical org+project pair cannot produce a reusable
        constant an attacker could learn once and replay."""
        assert oauth.make_state(ORG, PROJECT) != oauth.make_state(ORG, PROJECT)

    def test_garbage_never_raises(self):
        for bad in ["", ".", "....", "a.b", "!!!.???", None]:
            assert oauth.read_state(bad or "") is None

    def test_the_signature_is_compared_in_constant_time(self):
        """A timing-variable comparison on a MAC is how a signature gets forged
        one byte at a time."""
        import inspect
        assert "compare_digest" in inspect.getsource(oauth.read_state)


class TestProviders:
    def test_the_three_requested_providers_exist(self):
        assert {"notion", "stripe", "shopify"} <= set(oauth._providers())

    def test_stripe_asks_for_read_only(self):
        """This connector reads revenue for analytics. It has no business
        holding a scope that can move money."""
        assert oauth._providers()["stripe"].scopes == "read_only"

    def test_an_unconfigured_provider_is_not_offered(self):
        """A Connect button that dead-ends after the redirect is worse than
        none, so `available()` gates on real credentials."""
        assert all(oauth._providers()[a].configured for a in oauth.available())

    def test_start_refuses_an_unconfigured_provider_by_name(self, monkeypatch):
        monkeypatch.setattr(oauth, "_providers", lambda: {
            "notion": oauth.OAuthProvider(app="notion", authorize_url="https://x",
                                          token_url="https://y")})
        assert oauth.start("notion", ORG)["error"] == "not_configured"

    def test_start_refuses_an_unknown_connector(self):
        assert oauth.start("not-a-real-app", ORG)["error"] == "unknown_connector"

    def test_credentials_are_read_at_call_time(self):
        """A module-level snapshot would freeze "not configured" forever, so a
        credential added after boot would never take effect."""
        import inspect
        assert "def _providers()" in inspect.getsource(oauth)

    def test_a_per_shop_provider_requires_its_shop(self, monkeypatch):
        monkeypatch.setattr(oauth, "_providers", lambda: {
            "shopify": oauth.OAuthProvider(
                app="shopify", authorize_url="https://{shop}/admin/oauth/authorize",
                token_url="https://{shop}/admin/oauth/access_token",
                client_id="id", client_secret="secret")})
        assert oauth.start("shopify", ORG)["error"] == "shop_required"
        out = oauth.start("shopify", ORG, shop="demo.myshopify.com")
        assert out["ok"] and "demo.myshopify.com" in out["redirect_url"]


class TestConsentUrl:
    def _configured(self, monkeypatch):
        monkeypatch.setattr(oauth, "_providers", lambda: {
            "notion": oauth.OAuthProvider(
                app="notion", authorize_url="https://api.notion.com/v1/oauth/authorize",
                token_url="https://api.notion.com/v1/oauth/token",
                client_id="cid", client_secret="csecret", basic_auth=True)})

    def test_it_carries_a_verifiable_state(self, monkeypatch):
        self._configured(monkeypatch)
        from urllib.parse import parse_qs, urlparse
        url = oauth.start("notion", ORG, PROJECT)["redirect_url"]
        state = parse_qs(urlparse(url).query)["state"][0]
        assert oauth.read_state(state)["o"] == str(ORG)

    def test_the_redirect_uri_points_back_at_this_connector(self, monkeypatch):
        self._configured(monkeypatch)
        assert oauth.redirect_uri("notion").endswith("/connectors/notion/oauth/callback")

    def test_the_client_secret_never_appears_in_the_consent_url(self, monkeypatch):
        """It goes in the token exchange, server to server. In the authorize
        URL it would be in the user's address bar and their history."""
        self._configured(monkeypatch)
        assert "csecret" not in oauth.start("notion", ORG, PROJECT)["redirect_url"]
