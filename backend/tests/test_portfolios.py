"""Portfolios: CRUD, auto-rerun analytics, P&L tie-out, cache behavior."""

import pytest


@pytest.fixture()
def two_deals(client):
    for name in ("Port Deal One", "Port Deal Two"):
        r = client.post("/api/deals", json={"name": name})
        assert r.status_code == 201
    yield ["port-deal-one", "port-deal-two"]
    for slug in ("port-deal-one", "port-deal-two"):
        client.delete(f"/api/deals/{slug}")


@pytest.fixture()
def portfolio(client, two_deals):
    doc = client.post("/api/portfolios", json={"name": "Test Fund"}).json()
    doc["positions"] = [
        {"deal": two_deals[0], "tranche": "A", "face": 10_000_000, "cost_basis": 99.5},
        {"deal": two_deals[1], "tranche": "B", "face": 3_000_000, "cost_basis": 101.0},
    ]
    doc["marks"] = {"method": "spread", "default": 200.0,
                    "per_tranche": {two_deals[1]: {"B": 300.0}}}
    client.put("/api/portfolios/test-fund", json=doc)
    yield doc
    client.delete("/api/portfolios/test-fund")


def test_crud(client):
    doc = client.post("/api/portfolios", json={"name": "CRUD Fund"}).json()
    assert doc["meta"]["slug"] == "crud-fund"
    assert client.post("/api/portfolios", json={"name": "CRUD Fund"}).status_code == 409
    listed = client.get("/api/portfolios").json()
    assert any(p["slug"] == "crud-fund" for p in listed)
    assert client.delete("/api/portfolios/crud-fund").status_code == 204
    assert client.get("/api/portfolios/crud-fund").status_code == 404


def test_structure_validation(client):
    bad = client.post("/api/portfolios", json={
        "schema": "ccflows-ui.portfolio/1",
        "meta": {"name": "Bad Fund"},
        "positions": [{"deal": "x", "tranche": "A", "face": -5, "cost_basis": 100}],
    })
    assert bad.status_code == 422


def test_analytics_pnl_ties(client, portfolio):
    a = client.get("/api/portfolios/test-fund/analytics").json()
    rows = [r for r in a["rows"] if "error" not in r]
    assert len(rows) == 2
    for r in rows:
        expected = (r["price"] - r["cost_basis"]) / 100 * r["face"] * r["factor"]
        assert abs(r["pnl"] - expected) < 1.0
    assert abs(a["totals"]["pnl"] - sum(r["pnl"] for r in rows)) < 1.0
    # per-tranche mark override applied
    b_row = next(r for r in rows if r["tranche"] == "B")
    assert b_row["mark_value"] == 300.0


def test_analytics_caches_runs(client, portfolio):
    first = client.get("/api/portfolios/test-fund/analytics").json()
    second = client.get("/api/portfolios/test-fund/analytics").json()
    assert all(not v["reran"] for v in second["deals"].values() if "reran" in v)
    # editing the deal invalidates the cache
    deal = client.get("/api/deals/port-deal-one").json()
    deal["run"]["replines"][0]["inline"]["upb"] = 55_000_000.0
    client.put("/api/deals/port-deal-one", json=deal)
    third = client.get("/api/portfolios/test-fund/analytics").json()
    assert third["deals"]["port-deal-one"]["reran"] is True


def test_missing_deal_is_row_error(client, portfolio):
    doc = client.get("/api/portfolios/test-fund").json()
    doc["positions"].append({"deal": "ghost", "tranche": "A", "face": 1, "cost_basis": 100})
    client.put("/api/portfolios/test-fund", json=doc)
    a = client.get("/api/portfolios/test-fund/analytics").json()
    errors = [r for r in a["rows"] if "error" in r]
    assert len(errors) == 1 and errors[0]["deal"] == "ghost"
