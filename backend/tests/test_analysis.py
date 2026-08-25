"""Analysis endpoints: tranche pricing, tables, loan pricing, marks, breakeven."""

import time

import pytest


@pytest.fixture(scope="module")
def run_id(client):
    from core.document import new_deal

    doc = new_deal("Analysis Deal")
    r = client.post("/api/deals/analysis-deal/run", json={"doc": doc, "scenario": "base"})
    assert r.status_code == 200
    return doc, r.json()["run_id"]


def test_tranche_context(client, run_id):
    _, rid = run_id
    data = client.get(f"/api/runs/{rid}/analysis/tranches").json()
    names = [t["name"] for t in data["tranches"]]
    assert names == ["A", "B", "R"]
    assert not data["tranches"][2]["priceable"]


def test_price_at_own_coupon_is_par(client, run_id):
    _, rid = run_id
    p = client.post(f"/api/runs/{rid}/analysis/price",
                    json={"tranche": "B", "method": "yield", "value": 0.075}).json()
    assert abs(p["price"] - 100.0) < 0.05
    assert abs(p["mixin_price"] - p["price"]) < 0.05
    higher = client.post(f"/api/runs/{rid}/analysis/price",
                         json={"tranche": "B", "method": "yield", "value": 0.09}).json()
    assert higher["price"] < p["price"]


def test_zero_curve_pricing(client, run_id):
    _, rid = run_id
    p = client.post(f"/api/runs/{rid}/analysis/price", json={
        "tranche": "B", "method": "zero_curve",
        "nodes": [{"date": "2026-08-01", "rate": 0.05}, {"date": "2030-08-01", "rate": 0.045}],
    }).json()
    assert p["price"] > 100  # 7.5% coupon discounted at ~5% zero curve
    assert "note" in p
    bad = client.post(f"/api/runs/{rid}/analysis/price",
                      json={"tranche": "B", "method": "zero_curve", "nodes": []})
    assert bad.status_code == 422


def test_yield_and_price_tables(client, run_id):
    _, rid = run_id
    yt = client.get(f"/api/runs/{rid}/analysis/yield-table",
                    params={"tranche": "B", "prices": "98,100,102"}).json()
    assert len(yt["records"]) == 3 and yt["attrs"]["tranche"] == "B"
    pt = client.get(f"/api/runs/{rid}/analysis/price-table", params={"tranche": "B"}).json()
    assert pt["axis"] == "yield"  # fixed-rate tranche


def test_loan_pricing(client, run_id):
    _, rid = run_id
    lp = client.get(f"/api/runs/{rid}/analysis/loan-pricing",
                    params={"spread_bps": 200}).json()
    row = lp["rows"][0]
    assert row["wal_months"] > 0 and row["moic"] > 1
    tighter = client.get(f"/api/runs/{rid}/analysis/loan-pricing",
                         params={"spread_bps": 0}).json()["rows"][0]
    assert tighter["price_at_spread"] > row["price_at_spread"]


def test_marks(client, run_id):
    _, rid = run_id
    m = client.post(f"/api/runs/{rid}/analysis/marks",
                    json={"method": "spread", "values": {"A": 150, "B": 250, "R": 0}}).json()
    by = {r["tranche"]: r for r in m["rows"]}
    assert set(by) == {"A", "B", "R"}
    assert by["A"]["price"] is not None
    assert client.post(f"/api/runs/{rid}/analysis/marks",
                       json={"method": "nope", "values": 100}).status_code == 422


def test_unit_economics(client, run_id):
    _, rid = run_id
    rows = client.get(f"/api/runs/{rid}/analysis/unit-economics").json()["rows"]
    assert len(rows) == 1
    row = rows[0]
    assert row["upb"] > 0 and row["net_cash"] > 0 and row["moic"] > 1
    assert row["interest_revenue"] > 0
    assert abs(row["avg_balance"] - row["upb"] / row["accounts"]) < 1


def test_residual_solver_round_trip(client, run_id):
    _, rid = run_id
    fwd = client.post(f"/api/runs/{rid}/analysis/solve-collateral-price",
                      json={"target_yield": 0.20}).json()
    assert fwd["collateral_price"] > 0
    rev = client.post(f"/api/runs/{rid}/analysis/solve-collateral-price",
                      json={"collateral_price": fwd["collateral_price"]}).json()
    assert abs(rev["residual_yield"] - 0.20) < 1e-4
    # monotonic: a higher target yield implies a lower payable price
    fwd2 = client.post(f"/api/runs/{rid}/analysis/solve-collateral-price",
                       json={"target_yield": 0.30}).json()
    assert fwd2["collateral_price"] < fwd["collateral_price"]
    assert client.post(f"/api/runs/{rid}/analysis/solve-collateral-price",
                       json={}).status_code == 422


def test_breakeven_job(client, run_id):
    doc, _ = run_id
    job = client.post("/api/deals/analysis-deal/jobs/breakeven",
                      json={"doc": doc, "curve": "cdr", "tranches": ["B"]}).json()
    deadline = time.time() + 180
    while time.time() < deadline:
        s = client.get(f"/api/jobs/{job['job_id']}").json()
        if s["status"] in ("done", "error"):
            break
        time.sleep(0.3)
    assert s["status"] == "done", s
    res = client.get(f"/api/jobs/{job['job_id']}/result").json()
    row = res["rows"][0]
    assert row["tranche"] == "B"
    assert row["breakeven_multiplier"] is None or row["breakeven_multiplier"] > 1
