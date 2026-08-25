"""Run pipeline: base + stress runs, results retrieval, expiry."""

import pytest


@pytest.fixture(scope="module")
def base_run(client):
    from core.document import new_deal

    doc = new_deal("Run Deal")
    r = client.post("/api/deals/run-deal/run", json={"doc": doc, "scenario": "base"})
    assert r.status_code == 200, r.text
    return doc, r.json()


def test_stack_summary_shape(base_run):
    _, data = base_run
    tranches = [row["tranche"] for row in data["summary"]["records"]]
    assert tranches[:2] == ["A", "B"] and tranches[-1] == "R"
    a = data["tranche_metrics"]["A"]
    assert a["wal"] > 0 and a["xirr"] is not None and a["credit_enhancement"] > 0


def test_stress_orders_losses(client, base_run):
    doc, base = base_run
    sev = client.post("/api/deals/run-deal/run",
                      json={"doc": doc, "scenario": "severe_stress"}).json()

    def residual_principal(payload):
        row = next(r for r in payload["summary"]["records"] if r["tranche"] == "R")
        return row["principal_paid"] + row["interest_paid"]

    assert residual_principal(sev) < residual_principal(base)


def test_unknown_scenario_422(client, base_run):
    doc, _ = base_run
    r = client.post("/api/deals/run-deal/run", json={"doc": doc, "scenario": "apocalypse"})
    assert r.status_code == 422


def test_results_retrieval(client, base_run):
    _, data = base_run
    rid = data["run_id"]
    cf = client.get(f"/api/runs/{rid}/tranches/A/cashflows").json()
    assert "interest_paid" in cf["columns"] and len(cf["records"]) == 361
    bal = client.get(f"/api/runs/{rid}/balances").json()
    assert "A" in bal["tranches"] and len(bal["pool"]) == 361
    explain = client.get(f"/api/runs/{rid}/explain/12").json()["text"]
    assert "Collections" in explain
    assert client.get(f"/api/runs/{rid}/tranches/ZZ/cashflows").status_code == 404


def test_expired_run_410(client):
    assert client.get("/api/runs/deadbeef/stack").status_code == 410
