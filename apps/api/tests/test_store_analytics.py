"""The store dashboard's real arithmetic.

Only the measured parts are tested. The sample generators are deliberately not
asserted against: pinning invented numbers would make this suite fail every
time a placeholder is replaced by a real source, which is the one change it
should welcome.
"""
import inspect

import pytest

from app.services import store_analytics as sa


class TestReferrerClassification:
    """Which channel an order came through. The most consequential guess in the
    file: this is the number ad budgets are set from."""

    def test_a_google_referral_is_organic_unless_the_link_says_otherwise(self):
        assert sa.classify_referrer("https://www.google.com/", "https://shop.com/p") == "Organic search"

    def test_a_paid_marker_makes_it_paid_even_from_the_same_referrer(self):
        """gclid or utm_medium=cpc is the ONLY evidence that a click was bought.
        Calling organic traffic paid would credit ads for sales they did not
        make -- and the merchant would raise spend on the strength of it."""
        assert sa.classify_referrer(
            "https://www.google.com/", "https://shop.com/p?gclid=abc") == "Paid search"
        assert sa.classify_referrer(
            "https://www.google.com/", "https://shop.com/p?utm_medium=cpc") == "Paid search"

    def test_no_referrer_is_direct_not_unknown(self):
        assert sa.classify_referrer(None, None) == "Direct"
        assert sa.classify_referrer("", "https://shop.com/") == "Direct"

    def test_social_hosts_are_grouped_but_strangers_stay_referrals(self):
        assert sa.classify_referrer("https://t.co/xyz", None) == "Social"
        assert sa.classify_referrer("https://instagram.com/", None) == "Social"
        # An unknown domain keeps its own identity rather than being guessed into
        # a bucket it may not belong to.
        assert sa.classify_referrer("https://someblog.example/", None) == "Referral"

    def test_www_is_stripped_so_one_site_is_not_two_channels(self):
        assert sa.classify_referrer("https://www.facebook.com/", None) == "Social"
        assert sa.classify_referrer("https://facebook.com/", None) == "Social"


class TestUtmParsing:
    def test_campaign_tags_survive_on_the_landing_url(self):
        utm = sa.utm_params("https://shop.com/p?utm_source=news&utm_campaign=spring&x=1")
        assert utm["utm_source"] == "news"
        assert utm["utm_campaign"] == "spring"

    def test_a_url_without_a_query_yields_nothing_rather_than_raising(self):
        assert sa.utm_params("https://shop.com/p") == {}
        assert sa.utm_params(None) == {}
        assert sa.utm_params("") == {}

    def test_tag_names_are_matched_case_insensitively(self):
        assert sa.utm_params("https://s.com/?UTM_Campaign=Sale")["utm_campaign"] == "Sale"


class TestChangePercentage:
    def test_a_thin_period_returns_no_change_rather_than_a_big_one(self):
        """A 900% swing off two orders is not information. Returning None makes
        the UI print a dash; returning a number would put a green arrow beside
        something meaningless."""
        assert sa._change(100, 10, orders=2) is None

    def test_an_empty_previous_period_is_not_infinite_growth(self):
        assert sa._change(500, 0, orders=50) is None

    def test_a_real_comparison_is_computed(self):
        assert sa._change(150, 100, orders=50) == 50.0
        assert sa._change(80, 100, orders=50) == -20.0


class TestDailySeries:
    def test_days_without_orders_are_kept_as_zeros(self):
        """A chart that skips quiet days compresses a bad week into a flat line
        and hides exactly the drop worth seeing."""
        from datetime import date
        rows = sa._daily([], date(2026, 1, 1), 5)
        assert len(rows) == 5
        assert [r["date"] for r in rows] == [
            "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"]
        assert all(r["revenue"] == 0 and r["orders"] == 0 for r in rows)

    def test_the_moving_average_is_trailing_not_centred(self):
        """A centred window would use tomorrow's revenue to draw today's point,
        which reads as foresight the chart does not have."""
        series = [{"date": f"2026-01-0{i+1}", "revenue": float(v)}
                  for i, v in enumerate([10, 20, 30, 40])]
        sa._moving_average(series, window=2)
        assert [d["ma"] for d in series] == [10.0, 15.0, 25.0, 35.0]


class TestForecast:
    def _series(self, values):
        from datetime import date, timedelta
        start = date(2026, 1, 1)
        return [{"date": (start + timedelta(days=i)).isoformat(), "revenue": float(v)}
                for i, v in enumerate(values)]

    def test_too_little_history_produces_no_forecast_at_all(self):
        """Better to show nothing than to project a fortnight from four days."""
        assert sa.forecast_series(self._series([10, 20, 30, 40])) == []

    def test_a_rising_trend_continues_upward(self):
        out = sa.forecast_series(self._series(list(range(10, 110, 10))), horizon=5)
        assert len(out) == 5
        assert out[-1]["revenue"] > out[0]["revenue"]

    def test_the_projection_starts_the_day_after_the_data_ends(self):
        out = sa.forecast_series(self._series([10] * 14), horizon=3)
        assert out[0]["date"] == "2026-01-15"

    def test_a_falling_trend_is_never_projected_below_zero(self):
        """Extrapolating a decline far enough crosses zero. Negative revenue is
        not a possible future, and drawing one destroys trust in the whole
        chart."""
        out = sa.forecast_series(self._series(list(range(200, 0, -20))), horizon=14)
        assert all(p["revenue"] >= 0 for p in out)


class TestTenantScoping:
    def test_the_dashboard_requires_an_org(self):
        """Same guard as the revenue summary: project_id comes from the query
        string and is guessable, so org_id must be required and must reach the
        query."""
        params = inspect.signature(sa.dashboard).parameters
        assert "org_id" in params
        assert params["org_id"].default is inspect.Parameter.empty
        assert "StoreOrder.org_id == org_id" in inspect.getsource(sa._rows)


class TestCsvExport:
    def test_sample_columns_are_named_as_sample_in_the_header(self):
        """The badge that labels placeholder data on screen does not survive an
        export. The column name has to carry it instead, or a merchant opens the
        file next month with no way to tell which figures were invented."""
        header = sa.to_csv({"series": []}).splitlines()[0]
        assert "net_sales_sample" in header
        assert "profit_sample" in header
        # Measured columns stay plainly named.
        assert "revenue," in header and "orders," in header


class TestInsights:
    def _kpis(self, **over):
        base = {
            "revenue": {"value": 1000.0, "prev": 800.0, "change": 25.0},
            "orders": {"value": 40, "prev": 38, "change": 5.0},
            "aov": {"value": 25.0, "prev": 21.0, "change": 19.0},
        }
        base.update(over)
        return base

    def _ops(self):
        return {"low_stock": [], "out_of_stock": [], "refund_rate": 1.0, "unfulfilled": 0}

    def test_every_insight_declares_where_its_numbers_came_from(self):
        out = sa.build_insights(self._kpis(), [], [], [], self._ops(), "USD")
        assert out, "expected at least one insight"
        assert all(i["source"] in {"live", "sample", "derived"} for i in out)

    def test_insights_are_ranked_by_impact(self):
        out = sa.build_insights(self._kpis(), [], [], [], self._ops(), "USD")
        assert [i["impact"] for i in out] == sorted((i["impact"] for i in out), reverse=True)

    def test_a_flat_period_produces_no_revenue_claim(self):
        """Naming a 1% move as a change trains the reader to ignore the panel."""
        kpis = self._kpis(revenue={"value": 1000.0, "prev": 995.0, "change": 0.5})
        kinds = {i["kind"] for i in sa.build_insights(kpis, [], [], [], self._ops(), "USD")}
        assert "revenue" not in kinds

    def test_a_missing_comparison_never_becomes_a_claim(self):
        """change=None means unknown. An insight saying revenue is "up None%"
        -- or silently treating it as zero -- would be an invented fact."""
        kpis = self._kpis(revenue={"value": 1000.0, "prev": 0.0, "change": None})
        out = sa.build_insights(kpis, [], [], [], self._ops(), "USD")
        assert all(i["kind"] != "revenue" for i in out)

    def test_inventory_running_out_outranks_a_good_revenue_week(self):
        """The dashboard is read for what needs doing today. A stock-out is
        actionable in a way a percentage is not."""
        ops = {**self._ops(),
               "low_stock": [{"product": "Widget", "stock": 3, "days_left": 2.0}]}
        out = sa.build_insights(self._kpis(), [], [], [], ops, "USD")
        assert out[0]["kind"] == "inventory"

    @pytest.mark.parametrize("days,expected", [(0.4, "today"), (1.0, "in about a day"),
                                               (5.0, "in about 5 days")])
    def test_stock_warnings_read_as_english(self, days, expected):
        ops = {**self._ops(),
               "low_stock": [{"product": "Widget", "stock": 1, "days_left": days}]}
        out = sa.build_insights(self._kpis(), [], [], [], ops, "USD")
        assert expected in next(i["text"] for i in out if i["kind"] == "inventory")


class TestAlerts:
    def _kpis(self, change):
        return {"revenue": {"value": 100.0, "prev": 100.0, "change": change}}

    def _ops(self, **over):
        base = {"refund_rate": 1.0, "out_of_stock": [], "unfulfilled": 0}
        base.update(over)
        return base

    def test_an_unknown_change_raises_no_alert(self):
        out = sa.build_alerts(self._kpis(None), self._ops(), {"roas": 3.0})
        assert all(a["kind"] not in {"revenue_drop", "record"} for a in out)

    def test_a_real_drop_raises_one(self):
        out = sa.build_alerts(self._kpis(-30.0), self._ops(), {"roas": 3.0})
        assert any(a["kind"] == "revenue_drop" and a["severity"] == "bad" for a in out)

    def test_alerts_carry_their_source_so_sample_ones_can_be_labelled(self):
        out = sa.build_alerts(self._kpis(-30.0), self._ops(refund_rate=9.0), {"roas": 0.9})
        assert {a["kind"]: a["source"] for a in out}["refunds"] == "sample"
        assert {a["kind"]: a["source"] for a in out}["revenue_drop"] == "live"


class TestSourceLabelling:
    def test_the_funnel_is_pinned_to_the_real_order_count(self):
        """The funnel's last stage and the orders KPI are the same number on
        screen. If they disagreed, both would look wrong."""
        rows = store_mock_funnel = __import__(
            "app.services.store_mock", fromlist=["x"]).mock_funnel("p", 42, 5000)
        assert rows[-1]["stage"] == "Purchased"
        assert rows[-1]["users"] == 42
