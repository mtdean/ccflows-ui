"""Monitoring layer: tracked cache, covenants, surveillance, spliced series."""

import pytest


def _tape_doc(name, chargeoff_mult=1.6, months=8, tight_covenant=False):
    from core import engine_bridge
    from core.document import new_deal

    doc = new_deal(name)
    doc["covenants"] = [
        {"factory": "max_cnl", "params": {"limit": 0.0005 if tight_covenant else 0.06},
         "severity": "breach", "grace_months": 2, "cure_months": 2},
        {"factory": "min_pool_factor", "params": {"floor": 0.05}},
    ]
    replines, _ = engine_bridge.build_replines(doc)
    _, models, _ = engine_bridge.run_collateral(replines, doc["rates"], doc["run"]["run_date"])
    m = models[0]
    run = engine_bridge.run_deal(doc, scenario="base")
    col, bonds = [], []
    for mo in range(1, months + 1):
        col.append({"repline_id": "repline_1", "month": mo,
                    "upb_end": float(m.upb_end[0, mo]),
                    "interest_collected": float(m.revenue_interest[0, mo]),
                    "principal_collected": float(m.upb_prinpay[0, mo]),
                    "prepayments": float(m.upb_prepay[0, mo]),
                    "chargeoffs": float(m.upb_chargeoff[0, mo]) * chargeoff_mult,
                    "recoveries": float(m.upb_recovery[0, mo])})
        for i, tn in enumerate(["A", "B"]):
            bonds.append({"tranche": tn, "month": mo,
                          "balance_end": float(run.result.tranche_balance_end[i, mo]),
                          "interest_paid": float(run.result.tranche_interest_paid[i, mo]),
                          "principal_paid": float(run.result.tranche_principal_paid[i, mo])})
    doc["actuals"] = {"collateral": col, "bonds": bonds}
    return doc


@pytest.fixture(scope="module")
def monitored(client):
    return _tape_doc("Monitored Deal")


def test_overview(client, monitored):
    r = client.post("/api/deals/monitored-deal/monitor/overview", json={"doc": monitored})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"]["boundary_month"] == 8
    statuses = {row["tranche"]: row["status"] for row in d["bond_status"]["records"]}
    assert statuses["A"] == "performing"
    assert d["realized"]["realized_cdr"] > 0


def test_covenant_schema_matches_engine(client):
    from cashflows.actuals.covenants import COVENANT_FACTORIES

    data = client.get("/api/schema/covenants").json()
    assert {f["factory"] for f in data["factories"]} == set(COVENANT_FACTORIES)


def test_covenant_trip(client):
    doc = _tape_doc("Tripped Deal", chargeoff_mult=1.6, tight_covenant=True)
    r = client.post("/api/deals/tripped-deal/monitor/covenants", json={"doc": doc}).json()
    by = {row["name"]: row for row in r["summary"]["records"]}
    assert by["max_cnl"]["status"] in ("TRIPPED", "BREACHING")
    assert by["min_pool_factor"]["status"] == "COMPLIANT"
    assert "max_cnl" in r["details"]
    detail_cols = r["details"]["max_cnl"]["columns"]
    assert {"month", "observed", "threshold", "status"} <= set(detail_cols)


def test_surveillance_flags_hot_chargeoffs(client, monitored):
    r = client.post("/api/deals/monitored-deal/monitor/surveillance", json={"doc": monitored}).json()
    rules = {f["rule"] for f in r["flags"]["records"]}
    assert "cdr_1.5x_assumed" in rules


def test_bond_redline_perfect_tape_zero_variance(client, monitored):
    r = client.post("/api/deals/monitored-deal/monitor/bond-redline", json={"doc": monitored}).json()
    for row in r["summary"]["records"]:
        assert abs(row["cash_variance_pct"]) < 1e-6


def test_tranche_series_boundary(client, monitored):
    r = client.post("/api/deals/monitored-deal/monitor/tranche-series", json={"doc": monitored}).json()
    assert r["boundary_month"] == 8
    recs = r["series"]["records"]
    actual = [x for x in recs if x["is_actual"]]
    assert actual and max(x["month"] for x in actual) == 8
    assert min(x["month"] for x in actual) == 1


def test_performance_series_matches_seed(client, monitored):
    r = client.post("/api/deals/monitored-deal/monitor/performance-series",
                    json={"doc": monitored}).json()
    row = next(x for x in r["rows"] if x["month"] == 4)
    # tape chargeoffs are 1.6x model -> actual CDR ~1.6x projected
    assert row["actual_cdr"] == pytest.approx(row["projected_cdr"] * 1.6, rel=0.05)
    # prepays at 1.0x -> CPR lines should agree
    assert row["actual_cpr"] == pytest.approx(row["projected_cpr"], rel=0.02)
    assert "chargeoffs" in r["dollars"]


def test_monitor_requires_single_engine(client):
    from core.document import new_deal

    doc = new_deal("Mixed Pool")
    doc["run"]["replines"].append({
        "inline": {**doc["run"]["replines"][0]["inline"],
                   "repline_id": "card_1", "amortization_type": "revolving"}})
    r = client.post("/api/deals/mixed-pool/monitor/overview", json={"doc": doc})
    assert r.status_code == 422
