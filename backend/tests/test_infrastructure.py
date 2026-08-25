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
