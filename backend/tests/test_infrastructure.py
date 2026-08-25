"""Rates curves, config import, what-ifs, curve libraries, strips, rr-matrix."""

import pytest

FIXTURES = "/Users/td/ccflows/tests/fixtures/modular_json"


# ── rates curves ───────────────────────────────────────────────────────────

def test_rates_build_and_named_parity(client):
    from core.document import new_deal

    r = client.post("/api/rates-curves/build",
                    json={"name": "T Flat", "mode": "flat", "rate": 0.043, "overwrite": True})
    assert r.status_code == 201 and r.json()["n_rows"] == 361
    try:
        doc_a = new_deal("Rates Parity A")
        doc_b = new_deal("Rates Parity B")
        doc_b["rates"] = {"mode": "named", "curve": "t-flat", "index": "sofr_1m"}
        a = client.post("/api/deals/x/run", json={"doc": doc_a, "scenario": "base"}).json()
        b = client.post("/api/deals/y/run", json={"doc": doc_b, "scenario": "base"}).json()
        assert a["tranche_metrics"]["A"]["xirr"] == pytest.approx(
            b["tranche_metrics"]["A"]["xirr"], abs=1e-12)
    finally:
        client.delete("/api/rates-curves/t-flat")


def test_rates_points_interpolates(client):
    r = client.post("/api/rates-curves/build", json={
        "name": "T Points", "mode": "points", "overwrite": True,
        "points": [{"month": 0, "rate": 0.05}, {"month": 12, "rate": 0.04}]})
    assert r.status_code == 201
    try:
        doc = client.get("/api/rates-curves/t-points").json()
        rates = [rec["sofr_1m"] for rec in doc["records"]]
        assert rates[0] == pytest.approx(0.05)
        assert rates[6] == pytest.approx(0.045, abs=1e-9)   # linear midpoint
        assert rates[100] == pytest.approx(0.04)            # flat extrapolation
    finally:
        client.delete("/api/rates-curves/t-points")


def test_named_curve_validation(client):
    from core.document import new_deal

    doc = new_deal("Rates Missing")
    doc["rates"] = {"mode": "named", "curve": "does-not-exist", "index": "sofr_1m"}
    v = client.post("/api/validate/deal", json=doc).json()
    assert any("not found" in e["msg"] for e in v["errors"])


# ── config import ──────────────────────────────────────────────────────────

def test_import_base_case(client):
    r = client.post("/api/deals/import-config",
                    json={"path": f"{FIXTURES}/base_case.run.json", "name": "T Import Base"})
    assert r.status_code == 201, r.text
    try:
        inline = r.json()["run"]["replines"][0]["inline"]
        assert inline["upb"] == 5_000_000.0          # portfolio override applied
        assert inline["cdr"][0] == pytest.approx(0.01)  # prime_consumer curves
        run = client.post("/api/deals/t-import-base/run", json={"scenario": "base"})
        assert run.status_code == 200
    finally:
        client.delete("/api/deals/t-import-base")


def test_import_stressed(client):
    r = client.post("/api/deals/import-config",
                    json={"path": f"{FIXTURES}/stressed_scenario.run.json", "name": "T Import Str"})
    assert r.status_code == 201
    try:
        inline = r.json()["run"]["replines"][0]["inline"]
        assert inline["cdr"][0] == pytest.approx(0.025)   # 0.01 * recession 2.5x
    finally:
        client.delete("/api/deals/t-import-str")


def test_import_bad_path(client):
    r = client.post("/api/deals/import-config", json={"path": "/nope/nothing.run.json"})
    assert r.status_code == 422


# ── forward what-if ────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def whatif_run(client):
    from core.document import new_deal

    doc = new_deal("Whatif Fixture")
    return client.post("/api/deals/whatif-fixture/run",
                       json={"doc": doc, "scenario": "base"}).json()["run_id"]


def test_whatif_base_reproduces(client, whatif_run):
    r = client.post(f"/api/runs/{whatif_run}/analysis/forward-whatif",
                    json={"month": 12, "scenario": "base"})
    assert r.status_code == 200, r.text
    a = next(x for x in r.json()["forward"] if x["tranche"] == "A")
    assert a["xirr"] == pytest.approx(a["base_xirr"], abs=2e-3)


def test_whatif_adverse_hurts_residual(client, whatif_run):
    r = client.post(f"/api/runs/{whatif_run}/analysis/forward-whatif",
                    json={"month": 12, "scenario": "severely_adverse"}).json()
    res = next(x for x in r["forward"] if x["tranche"] == "R")
    assert res["xirr"] < res["base_xirr"]
    assert client.post(f"/api/runs/{whatif_run}/analysis/forward-whatif",
                       json={"month": 12, "scenario": "nope"}).status_code == 422


# ── curve libraries ────────────────────────────────────────────────────────

def test_curve_lib_round_trip(client):
    from core.document import new_deal

    doc = new_deal("Lib Fixture")
    r = client.post("/api/curves-libs/from-repline",
                    json={"doc": doc, "repline_id": "repline_1",
                          "name": "T Lib", "overwrite": True})
    assert r.status_code == 201
    try:
        assert set(r.json()["specified"]) == {"cdr", "cpr"}
        lib = client.get("/api/curves-libs/t-lib").json()
        assert lib["curves"]["cdr"][0] == pytest.approx(
            doc["run"]["replines"][0]["inline"]["cdr"][0])
        assert len(lib["curves"]["cdr"]) == 361
    finally:
        client.delete("/api/curves-libs/t-lib")


# ── strips + rr-matrix through the engine ──────────────────────────────────

def test_io_strip_runs(client):
    from core.document import new_deal

    doc = new_deal("Strip Deal")
    doc["waterfall"]["bonds"].insert(2, {
        "type": "io_strip", "name": "IO", "coupon": 0.02, "margin": None,
        "floating": False, "notional_of": "A"})
    r = client.post("/api/deals/strip-deal/run", json={"doc": doc, "scenario": "base"})
    assert r.status_code == 200, r.text
    tranches = [row["tranche"] for row in r.json()["summary"]["records"]]
    assert "IO" in tranches
    # bad notional_of -> validation error
    doc["waterfall"]["bonds"][2]["notional_of"] = "ZZ"
    v = client.post("/api/validate/waterfall", json=doc["waterfall"]).json()
    assert not v["ok"]


def test_rr_matrix_runs(client):
    from core.document import new_deal

    doc = new_deal("Rollrate Deal")
    inline = doc["run"]["replines"][0]["inline"]
    inline["cdr"] = [0.0] * 361
    matrix = [[0.0] * 9 for _ in range(9)]
    matrix[0][0], matrix[0][1] = 0.97, 0.03
    for i in range(1, 7):
        matrix[i][0], matrix[i][min(i + 1, 8)] = 0.4, 0.6
    matrix[7][7] = 1.0
    matrix[8][8] = 1.0
    inline["rr_matrix"] = matrix
    r = client.post("/api/deals/rollrate-deal/run", json={"doc": doc, "scenario": "base"})
    assert r.status_code == 200, r.text
    # loss framework flipped to roll_rate
    from core import engine_bridge

    replines, _ = engine_bridge.build_replines(doc)
    assert replines[0].loss_type == "roll_rate"


# ── deal templates ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("key", ["amortizing", "royalty", "clo", "forward-flow"])
def test_deal_templates_validate_and_run(client, key):
    t = client.get(f"/api/deal-templates/{key}")
    assert t.status_code == 200
    doc = t.json()
    v = client.post("/api/validate/deal", json=doc).json()
    assert v["ok"], v["errors"]
    r = client.post(f"/api/deals/t-tmpl-{key}/run", json={"doc": doc, "scenario": "base"})
    assert r.status_code == 200, r.text


def test_deal_templates_listed_and_compact(client):
    keys = {t["key"] for t in client.get("/api/deal-templates").json()}
    assert keys == {"amortizing", "royalty", "clo", "forward-flow"}
    doc = client.get("/api/deal-templates/amortizing").json()
    assert len(doc["run"]["replines"][0]["inline"]["cdr"]) == 1  # engine pads
    assert "AUTHORING NOTES" in doc["meta"]["notes"]


# ── mark book ──────────────────────────────────────────────────────────────

def test_mark_book_schedule_and_resolution(client):
    from core.document import new_deal

    # a deal + a fund holding its A tranche
    doc = new_deal("Markbook Deal")
    assert client.post("/api/deals", json=doc).status_code == 201
    pf = client.post("/api/portfolios", json={"name": "Markbook Fund"}).json()
    pf["positions"] = [{"deal": "markbook-deal", "tranche": "A",
                        "face": 1_000_000, "cost_basis": 100.0}]
    pf["marks"] = {"method": "spread", "default": 999.0, "per_tranche": {}}
    client.put("/api/portfolios/markbook-fund", json=pf)
    try:
        # book entry with a stepped schedule wins over the fund default
        client.put("/api/mark-book/entry", json={
            "deal": "markbook-deal", "tranche": "A", "method": "spread",
            "schedule": {"0": 150, "6": 200}})
        a = client.get("/api/portfolios/markbook-fund/analytics").json()
        row = next(r for r in a["rows"] if "error" not in r)
        assert row["mark_source"] == "book" and row["mark_value"] == 150.0  # boundary 0
        # per-position override beats the book
        pf2 = client.get("/api/portfolios/markbook-fund").json()
        pf2["marks"]["per_tranche"] = {"markbook-deal": {"A": 300.0}}
        client.put("/api/portfolios/markbook-fund", json=pf2)
        a2 = client.get("/api/portfolios/markbook-fund/analytics").json()
        row2 = next(r for r in a2["rows"] if "error" not in r)
        assert row2["mark_source"] == "override" and row2["mark_value"] == 300.0
        # matrix shows the schedule; import merges a point
        mb = client.get("/api/mark-book").json()
        mrow = next(r for r in mb["rows"]
                    if r["deal"] == "markbook-deal" and r["tranche"] == "A")
        assert mrow["schedule"] == {"0": 150.0, "6": 200.0}
        imp = client.post("/api/mark-book/import", json={"rows": [
            {"deal": "Markbook Deal", "tranche": "B", "value": 275}]}).json()
        assert imp["applied"] == 1
        # empty schedule deletes
        client.put("/api/mark-book/entry", json={
            "deal": "markbook-deal", "tranche": "A", "method": "spread", "schedule": {}})
        mb2 = client.get("/api/mark-book").json()
        mrow2 = next(r for r in mb2["rows"]
                     if r["deal"] == "markbook-deal" and r["tranche"] == "A")
        assert mrow2["schedule"] is None
    finally:
        client.delete("/api/portfolios/markbook-fund")
        client.delete("/api/deals/markbook-deal")
        client.put("/api/mark-book/entry", json={
            "deal": "markbook-deal", "tranche": "B", "method": "spread", "schedule": {}})


def test_pnl_uses_book_schedule(client):
    import sys
    sys.path.insert(0, "tests")
    from test_monitor import _tape_doc

    doc = _tape_doc("Pnl Book Deal")
    assert client.post("/api/deals", json=doc).status_code == 201
    try:
        client.put("/api/mark-book/entry", json={
            "deal": "pnl-book-deal", "tranche": "A", "method": "spread",
            "schedule": {"0": 150, "4": 250}})
        p = client.post("/api/deals/pnl-book-deal/monitor/pnl",
                        json={"spreads": 200, "freq": "M", "use_book": True})
        assert p.status_code == 200, p.text
        data = p.json()
        assert data["book_used"] == ["A"]
        for name, s in data["statements"].items():
            for r in s["rollforward"]["records"]:
                if r["tie_check"] is not None:
                    assert abs(r["tie_check"]) < 1e-6, name
    finally:
        client.delete("/api/deals/pnl-book-deal")
        client.put("/api/mark-book/entry", json={
            "deal": "pnl-book-deal", "tranche": "A", "method": "spread", "schedule": {}})


# ── fund treasury + fund P&L ───────────────────────────────────────────────

def test_fund_treasury_ledger(client):
    import math
    import sys
    sys.path.insert(0, "tests")
    from test_monitor import _tape_doc

    doc = _tape_doc("Treasury Deal")
    assert client.post("/api/deals", json=doc).status_code == 201
    pf = client.post("/api/portfolios", json={"name": "Treasury Fund"}).json()
    pf["positions"] = [{"deal": "treasury-deal", "tranche": "A",
                        "face": 10_000_000, "cost_basis": 100.0}]
    client.put("/api/portfolios/treasury-fund", json=pf)
    try:
        run_month = doc["run"]["run_date"][:7]
        r = client.put("/api/portfolios/treasury-fund/treasury", json={
            "opening_cash": 2_000_000,
            "credit_line": {"limit": 10_000_000, "rate": 0.06},
            "events": [
                {"month": run_month, "type": "contribution", "amount": 8_000_000},
                {"month": run_month, "type": "draw", "amount": 4_000_000},
            ]})
        assert r.status_code == 200
        led = client.get("/api/portfolios/treasury-fund/treasury?horizon_months=12").json()
        rows = led["rows"]
        assert rows, led
        first = rows[0]
        # opening 2M + contrib 8M + draw 4M - purchase 10M = 4M closing
        assert math.isclose(first["closing_cash"], 4_000_000, abs_tol=1)
        assert math.isclose(first["credit_drawn"], 4_000_000, abs_tol=1)
        assert math.isclose(first["dry_powder"],
                            first["closing_cash"] + 6_000_000, abs_tol=1)
        for row in rows:
            assert math.isclose(row["closing_cash"],
                                row["opening_cash"] + row["net_cash_flow"], abs_tol=0.01)
        # interest accrues on the drawn balance from the next month
        assert rows[1]["credit_interest"] == pytest.approx(4_000_000 * 0.06 / 12)
        # receipts arrive (position holds A which amortizes)
        assert sum(r_["deal_receipts"] for r_ in rows) > 0
        # events beyond the credit limit are clipped with a note
        client.put("/api/portfolios/treasury-fund/treasury", json={
            "opening_cash": 0, "credit_line": {"limit": 1_000_000, "rate": 0.06},
            "events": [{"month": run_month, "type": "draw", "amount": 5_000_000}]})
        led2 = client.get("/api/portfolios/treasury-fund/treasury").json()
        assert "clipped" in led2["rows"][0]["notes"]
        assert led2["rows"][0]["credit_drawn"] == pytest.approx(1_000_000)

        # revolver commitment: dry powder reads gross AND net of unfunded
        pf2 = client.get("/api/portfolios/treasury-fund").json()
        pf2["positions"][0]["commitment"] = 25_000_000  # funded face 10M
        client.put("/api/portfolios/treasury-fund", json=pf2)
        led3 = client.get("/api/portfolios/treasury-fund/treasury").json()
        snap = led3["snapshot"]
        assert snap["unfunded_commitments"] == pytest.approx(15_000_000)
        assert snap["dry_powder_net"] == pytest.approx(snap["dry_powder"] - 15_000_000)
        assert led3["rows"][0]["dry_powder_net"] == pytest.approx(
            led3["rows"][0]["dry_powder"] - 15_000_000)
        assert snap["commitments_by_position"][0]["unfunded"] == pytest.approx(15_000_000)
        # analytics rows surface the unfunded slice too
        a = client.get("/api/portfolios/treasury-fund/analytics").json()
        assert a["rows"][0]["unfunded"] == pytest.approx(15_000_000)
        # negative commitment rejected
        pf2["positions"][0]["commitment"] = -1
        assert client.put("/api/portfolios/treasury-fund", json=pf2).status_code == 422
    finally:
        client.delete("/api/portfolios/treasury-fund")
        client.delete("/api/deals/treasury-deal")


def test_fund_pnl_aggregates(client):
    import sys
    sys.path.insert(0, "tests")
    from test_monitor import _tape_doc

    doc = _tape_doc("Fundpnl Deal")
    assert client.post("/api/deals", json=doc).status_code == 201
    pf = client.post("/api/portfolios", json={"name": "Fundpnl Fund"}).json()
    pf["positions"] = [
        {"deal": "fundpnl-deal", "tranche": "A", "face": 5_000_000, "cost_basis": 99.0},
        {"deal": "fundpnl-deal", "tranche": "B", "face": 2_000_000, "cost_basis": 98.0},
    ]
    client.put("/api/portfolios/fundpnl-fund", json=pf)
    try:
        p = client.get("/api/portfolios/fundpnl-fund/pnl?freq=Q")
        assert p.status_code == 200, p.text
        rows = p.json()["rows"]
        assert rows and not p.json()["skipped"]
        # begin/end MV chain across buckets
        for prev, cur in zip(rows, rows[1:]):
            assert cur["beginning_mv"] == pytest.approx(prev["ending_mv"], rel=1e-6)
        assert sum(r["interest_income"] for r in rows) > 0
    finally:
        client.delete("/api/portfolios/fundpnl-fund")
        client.delete("/api/deals/fundpnl-deal")


# ── securitization takeout ─────────────────────────────────────────────────

def test_takeout_lifecycle(client):
    import sys
    sys.path.insert(0, "tests")
    from test_monitor import _tape_doc

    doc = _tape_doc("Warehouse Wh")   # 8 months of actuals
    assert client.post("/api/deals", json=doc).status_code == 201
    pf = client.post("/api/portfolios", json={"name": "Takeout Fund"}).json()
    pf["positions"] = [{"deal": "warehouse-wh", "tranche": "A",
                        "face": 10_000_000, "cost_basis": 100.0}]
    client.put("/api/portfolios/takeout-fund", json=pf)
    try:
        from core import engine_bridge
        base_replines, _ = engine_bridge.build_replines(doc)
        orig_cdr8 = float(base_replines[0].cdr[8])

        r = client.post("/api/deals/warehouse-wh/securitize", json={
            "month": 8, "name": "Wh Term", "structure": "abr",
            "takeout_price_pct": 100.0,
            "roll_fund": {"portfolio": "takeout-fund",
                          "add_positions": [{"tranche": "A", "face": 5_000_000,
                                             "cost_basis": 100.0}]}})
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["changes"]["seasoned_from"] == "actuals"
        term = d["term_deal"]
        inline = term["run"]["replines"][0]["inline"]
        assert inline["age"] == 8
        assert inline["cdr"][0] == pytest.approx(orig_cdr8)   # curve re-anchored
        assert inline["upb"] == pytest.approx(d["changes"]["seasoned_balance"])
        # term deal runs
        assert client.post("/api/deals/wh-term/run",
                           json={"scenario": "base"}).status_code == 200
        # warehouse call set
        wh = client.get("/api/deals/warehouse-wh").json()
        assert wh["call"]["enabled"] and wh["call"]["call_month"] == 8
        # fund kept the warehouse position AND gained the term one
        fund = client.get("/api/portfolios/takeout-fund").json()
        deals_held = {p["deal"] for p in fund["positions"]}
        assert deals_held == {"warehouse-wh", "wh-term"}
        # ledger: call payoff lands in the takeout calendar month
        led = client.get("/api/portfolios/takeout-fund/treasury?horizon_months=6").json()
        takeout_period = str(__import__("pandas").Period(doc["run"]["run_date"][:7], freq="M") + 8)
        row = next(x for x in led["rows"] if x["period"] == takeout_period)
        assert row["deal_receipts"] > 5_000_000        # A payoff ~ its month-8 balance
        assert row["purchases"] == pytest.approx(5_000_000)
    finally:
        client.delete("/api/portfolios/takeout-fund")
        client.delete("/api/deals/warehouse-wh")
        client.delete("/api/deals/wh-term")
