"""Demo deals (royalty / CLO / forward-flow) and actuals splice + redline."""

import pytest


@pytest.fixture(scope="module")
def actuals_doc(client):
    """A deal + 6 months of tape scraped off its own model, slightly perturbed."""
    from core import engine_bridge
    from core.document import new_deal

    doc = new_deal("Tape Deal")
    replines, _ = engine_bridge.build_replines(doc)
    _, models, _ = engine_bridge.run_collateral(replines, doc["rates"], doc["run"]["run_date"])
    m = models[0]
    rows = [{
        "repline_id": "repline_1", "month": mo,
        "upb_end": float(m.upb_end[0, mo]) * 0.995,
        "interest_collected": float(m.revenue_interest[0, mo]),
        "principal_collected": float(m.upb_prinpay[0, mo]),
        "prepayments": float(m.upb_prepay[0, mo]) * 1.3,
        "chargeoffs": float(m.upb_chargeoff[0, mo]) * 1.5,
        "recoveries": float(m.upb_recovery[0, mo]),
    } for mo in range(1, 7)]
    doc["actuals"] = {"collateral": rows, "bonds": []}
    return doc


def _demo(build_name):
    import scripts.make_demos as demos

    return getattr(demos, build_name)()


@pytest.mark.parametrize("builder", ["royalty_deal", "clo_deal", "forward_flow_deal"])
def test_demo_deals_run(client, builder):
    doc = _demo(builder)
    slug = doc["meta"]["name"].lower().replace(" ", "-")
    r = client.post(f"/api/deals/{slug}/run", json={"doc": doc, "scenario": "base"})
    assert r.status_code == 200, r.text
    data = r.json()
    tranches = [row["tranche"] for row in data["summary"]["records"]]
    assert len(tranches) >= 2
    if builder == "forward_flow_deal":
        assert data["is_portfolio"] is True
    if builder == "clo_deal":
        assert tranches == ["A", "B", "C", "D", "R"]
        xirrs = [row["xirr"] for row in data["summary"]["records"] if row["xirr"] is not None]
        assert xirrs == sorted(xirrs)  # subordination ordering


def test_forward_flow_blocks_mc_and_breakeven(client):
    doc = _demo("forward_flow_deal")
    r = client.post("/api/deals/x/jobs/monte-carlo",
                    json={"doc": doc, "n_sims": 5,
                          "samplers": [{"field": "cdr", "type": "lognormal"}]})
    assert r.status_code == 422


def test_actuals_validate(client, actuals_doc):
    rows = actuals_doc["actuals"]["collateral"]
    v = client.post("/api/validate/actuals", json={"level": "collateral", "records": rows}).json()
    assert v["ok"] and v["months"]["last"] == 6
    bad = client.post("/api/validate/actuals",
                      json={"level": "collateral", "records": [{"repline_id": "x"}]}).json()
    assert not bad["ok"]


def test_spliced_run(client, actuals_doc):
    r = client.post("/api/deals/tape-deal/run", json={"doc": actuals_doc, "scenario": "base"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["boundary_month"] == 6
    assert any("Spliced" in w for w in data["warnings"])


def test_redline(client, actuals_doc):
    r = client.post("/api/actuals/redline", json={"doc": actuals_doc})
    assert r.status_code == 200, r.text
    data = r.json()
    row = data["summary"]["records"][0]
    assert row["months_covered"] == 6
    assert row["loss_variance_pct"] > 0  # tape had 1.5x model chargeoffs
    assert "upb_end" in data["details"]
