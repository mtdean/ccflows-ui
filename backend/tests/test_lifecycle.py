"""P&L/close, sensitivities, tranche MC, call/reinvest, portfolio IRRs."""

import time

import pytest

from test_monitor import _tape_doc


def wait_done(client, job_id, timeout=240):
    deadline = time.time() + timeout
    while time.time() < deadline:
        s = client.get(f"/api/jobs/{job_id}").json()
        if s["status"] in ("done", "error", "cancelled"):
            return s
        time.sleep(0.3)
    raise TimeoutError(job_id)


# ── P&L + close ────────────────────────────────────────────────────────────

@pytest.fixture()
def saved_tape_deal(client):
    doc = _tape_doc("Lifecycle Deal")
    assert client.post("/api/deals", json=doc).status_code == 201
    yield doc
    client.delete("/api/deals/lifecycle-deal")


def test_pnl_ties(client, saved_tape_deal):
    r = client.post("/api/deals/lifecycle-deal/monitor/pnl",
                    json={"doc": saved_tape_deal, "spreads": 200, "freq": "Q"})
    assert r.status_code == 200, r.text
    for name, stmt in r.json()["statements"].items():
        for row in stmt["rollforward"]["records"]:
            if row["tie_check"] is not None:
                assert abs(row["tie_check"]) < 1e-6, name
        assert "irr_to_date" in stmt["summary"]


def test_close_lifecycle(client, saved_tape_deal):
    r = client.post("/api/deals/lifecycle-deal/close", json={"spreads": 200})
    assert r.status_code == 200, r.text
    month = r.json()["close_month"]
    assert client.post("/api/deals/lifecycle-deal/close",
                       json={"spreads": 200}).status_code == 409
    history = client.get("/api/deals/lifecycle-deal/closes").json()["history"]["records"]
    assert any(h["month"] == month for h in history)
    drift = client.post(f"/api/deals/lifecycle-deal/closes/{month}/drift").json()
    assert drift["clean"] is True
    amended = client.post("/api/deals/lifecycle-deal/close",
                          json={"spreads": 300, "overwrite": True,
                                "amendment_note": "restated"})
    assert amended.status_code == 200


# ── sensitivities job ──────────────────────────────────────────────────────

def test_sensitivities_job(client):
    from core.document import new_deal

    doc = new_deal("Sens Deal")
    job = client.post("/api/deals/sens-deal/jobs/sensitivities",
                      json={"doc": doc, "tranche": "B", "spread_bps": 250,
                            "multipliers": [1.0, 2.0], "shocks_bps": [0, 100],
                            "scenarios": ["baseline"]}).json()
    status = wait_done(client, job["job_id"])
    assert status["status"] == "done", status
    res = client.get(f"/api/jobs/{job['job_id']}/result").json()
    assert {r["factor"] for r in res["tornado"]} == {"cdr", "cpr", "rate", "macro"}
    assert res["tornado"] == sorted(res["tornado"], key=lambda r: r["rank"])
    assert "effective_duration" in res["factors"]["rate"]["attrs"]
    assert client.post("/api/deals/sens-deal/jobs/sensitivities",
                       json={"doc": doc}).status_code == 422  # tranche required


# ── tranche MC ─────────────────────────────────────────────────────────────

def test_tranche_mc_deterministic(client):
    from core.document import new_deal

    doc = new_deal("Tmc Deal")
    body = {"doc": doc, "n_sims": 15, "seed": 3,
            "samplers": [{"field": "cdr", "type": "lognormal", "sigma": 0.5}],
            "spreads": 200}

    def run_once():
        job = client.post("/api/deals/tmc-deal/jobs/tranche-mc", json=body).json()
        status = wait_done(client, job["job_id"])
        assert status["status"] == "done", status
        return client.get(f"/api/jobs/{job['job_id']}/result").json()

    a, b = run_once(), run_once()
    assert a["tranches"] == b["tranches"]
    assert a["n_sims"] == 15
    names = {t["tranche"] for t in a["tranches"]}
    assert names == {"A", "B", "R"}
    assert "B" in a["price_distribution"]


# ── call + reinvestment ────────────────────────────────────────────────────

def test_call_shortens_wal(client):
    from core.document import new_deal

    doc = new_deal("Called Deal")
    doc["call"] = {"enabled": True, "call_month": 30, "nc_months": 24,
                   "call_price_pct": 100.0, "clean_up_call": False,
                   "clean_up_call_pct": 0.10}
    called = client.post("/api/deals/called-deal/run",
                         json={"doc": doc, "scenario": "base"}).json()
    base = client.post("/api/deals/called-deal/run",
                       json={"doc": new_deal("Called Deal"), "scenario": "base"}).json()
    assert called["reinvestment"]["call_month_effective"] == 30
    assert called["tranche_metrics"]["B"]["wal"] < base["tranche_metrics"]["B"]["wal"]


def test_reinvestment_window(client):
    from cashflows.liabilities import from_clo
    from cashflows.liabilities.spec import waterfall_to_dict
    from cashflows.securitization.tranches import CoverageTest, TrancheSpec

    from core.document import new_deal

    doc = new_deal("Revolving Deal")
    wf = from_clo([TrancheSpec("A", size_pct=0.8, coupon=0.055),
                   TrancheSpec("B", size_pct=0.12, coupon=0.075),
                   TrancheSpec("R", is_residual=True)],
                  coverage_tests=[CoverageTest(tranche="B", oc_trigger=1.05)],
                  reinvestment=True)
    doc["waterfall"] = waterfall_to_dict(wf)
    doc["reinvestment"] = {"enabled": True, "reinvest_months": 18,
                           "template_repline_id": "repline_1",
                           "purchase_price_pct": 99.5, "reinvest_share": 1.0,
                           "max_iterations": 6}
    r = client.post("/api/deals/revolving-deal/run", json={"doc": doc, "scenario": "base"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["reinvestment"]["total_faces"] > 0
    series = client.get(f"/api/runs/{data['run_id']}/reinvestment").json()
    spend = series["spend"]
    assert sum(spend[1:19]) > 0 and sum(spend[19:]) == 0


# ── portfolio IRRs ─────────────────────────────────────────────────────────

def test_portfolio_irrs(client):
    from core.document import new_deal

    tape = _tape_doc("Irr Tape Deal")
    plain = new_deal("Irr Plain Deal")
    assert client.post("/api/deals", json=tape).status_code == 201
    assert client.post("/api/deals", json=plain).status_code == 201
    pf = client.post("/api/portfolios", json={"name": "Irr Test Fund"}).json()
    pf["positions"] = [
        {"deal": "irr-tape-deal", "tranche": "B", "face": 5_000_000, "cost_basis": 98.0},
        {"deal": "irr-plain-deal", "tranche": "A", "face": 10_000_000, "cost_basis": 100.0},
    ]
    pf["marks"] = {"method": "spread", "default": 250.0, "per_tranche": {}}
    client.put("/api/portfolios/irr-test-fund", json=pf)
    try:
        d = client.get("/api/portfolios/irr-test-fund/analytics").json()
        by = {(r["deal"], r["tranche"]): r for r in d["rows"] if "error" not in r}
        a_row = by[("irr-plain-deal", "A")]
        # bought at par -> hold IRR ~ the tranche's own XIRR (5.5% coupon deal)
        assert a_row["irr_to_live"] == pytest.approx(0.055, abs=0.01)
        assert a_row["fm_irr"] is None  # no actuals -> nothing realized
        b_row = by[("irr-tape-deal", "B")]
        assert b_row["irr_to_live"] is not None and b_row["fm_irr"] is not None
        assert d["totals"]["irr_to_live"] is not None
        assert d["deals"]["irr-tape-deal"].get("boundary_month") == 8
    finally:
        client.delete("/api/portfolios/irr-test-fund")
        client.delete("/api/deals/irr-tape-deal")
        client.delete("/api/deals/irr-plain-deal")
