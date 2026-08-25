"""Embedded Pensford crawler: status, manual refresh, failure handling."""


def test_refresh_success_upserts_curve(client, monkeypatch):
    from cashflows.rates.providers import FlatRatesProvider

    from core import pensford_crawler

    fake = FlatRatesProvider(rate=0.042).get_rates(index_rate="sofr_1m")
    monkeypatch.setattr(pensford_crawler, "fetch_pensford_df", lambda: fake)

    r = client.post("/api/pensford/refresh")
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["curve_exists"] is True
    assert out["last_error"] is None
    assert out["fetched_at"]

    curve = client.get("/api/rates-curves/pensford-sofr").json()
    assert curve["meta"]["fetched_at"] == out["fetched_at"]
    assert any("sofr" in c for c in curve["records"][0] if c != "date")

    client.delete("/api/rates-curves/pensford-sofr")


def test_refresh_failure_is_502_with_reason(client, monkeypatch):
    from core import pensford_crawler

    def boom():
        raise RuntimeError("no route to pensford")

    monkeypatch.setattr(pensford_crawler, "fetch_pensford_df", boom)
    r = client.post("/api/pensford/refresh")
    assert r.status_code == 502
    assert "no route to pensford" in r.json()["detail"]

    status = client.get("/api/pensford/status").json()
    assert status["last_error"] == "no route to pensford"
    assert status["curve_slug"] == "pensford-sofr"


def test_auto_start_respects_env(monkeypatch):
    from core import pensford_crawler

    # CCFLOWS_PENSFORD_AUTO=0 (set by conftest) -> start() is a no-op
    pensford_crawler.start()
    assert pensford_crawler.status()["running"] is False
