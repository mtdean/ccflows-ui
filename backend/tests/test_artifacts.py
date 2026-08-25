"""Artifact lifecycle: scenario runs, book closes, FM approval, load sources,
assumption-change flags, and the portfolio good-through date."""

import pytest


@pytest.fixture()
def deal(client):
    r = client.post("/api/deals", json={"name": "Artifact Deal"})
    assert r.status_code == 201
    yield "artifact-deal"
    client.delete("/api/deals/artifact-deal")


@pytest.fixture()
def fund(client, deal):
    doc = client.post("/api/portfolios", json={"name": "Artifact Fund"}).json()
    doc["positions"] = [
        {"deal": deal, "tranche": "A", "face": 10_000_000, "cost_basis": 99.0}]
    doc["marks"] = {"method": "spread", "default": 200.0, "per_tranche": {}}
    client.put("/api/portfolios/artifact-fund", json=doc)
    yield "artifact-fund"
    client.delete("/api/portfolios/artifact-fund")


# --- scenario runs ----------------------------------------------------------

def test_scenario_run_roundtrip(client, deal):
    r = client.post(f"/api/deals/{deal}/scenario-runs",
                    json={"name": "Rate Spike Q3", "scenario": "severe_stress",
                          "notes": "committee ask"})
    assert r.status_code == 201, r.text
    assert r.json()["slug"] == "rate-spike-q3"
    assert "A" in r.json()["metrics"]

    listed = client.get(f"/api/deals/{deal}/scenario-runs").json()["scenarios"]
    assert [s["slug"] for s in listed] == ["rate-spike-q3"]

    full = client.get(f"/api/deals/{deal}/scenario-runs/rate-spike-q3").json()
    assert full["doc"]["meta"]["slug"] == deal
    assert full["stress"]["scenario"] == "severe_stress"

    src = client.post(f"/api/deals/{deal}/load-source",
                      json={"kind": "scenario", "ref": "rate-spike-q3"}).json()
    assert src["doc"]["meta"]["slug"] == deal
    assert "Rate Spike Q3" in src["origin"]

    assert client.delete(
        f"/api/deals/{deal}/scenario-runs/rate-spike-q3").status_code == 204
    assert client.get(
        f"/api/deals/{deal}/scenario-runs/rate-spike-q3").status_code == 404


def test_scenario_bad_stress_422(client, deal):
    r = client.post(f"/api/deals/{deal}/scenario-runs",
                    json={"name": "Nope", "scenario": "not-a-scenario"})
    assert r.status_code == 422


# --- book closes ------------------------------------------------------------

def test_book_close_lifecycle(client, deal, fund):
    # mark with a rationale note
    client.put("/api/mark-book/entry", json={
        "deal": deal, "tranche": "A", "method": "spread",
        "schedule": {"0": 250}, "note": "widened 50bp on servicer transfer"})

    r = client.post("/api/book-closes", json={"month": "2026-07", "notes": "first close"})
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "abf"
    assert r.json()["n_deals"] == 1
    # duplicate blocked without overwrite
    assert client.post("/api/book-closes", json={"month": "2026-07"}).status_code == 409

    full = client.get("/api/book-closes/2026-07").json()
    assert full["deals"][deal]["doc"]["meta"]["slug"] == deal
    assert full["marks"][deal]["tranches"]["A"]["note"] == \
        "widened 50bp on servicer transfer"
    assert full["marks"][deal]["tranches"]["A"]["value_at_boundary"] == 250
    assert fund in full["portfolios"]

    # not approved yet -> no fm-final, no good-through
    assert client.get(f"/api/portfolios/{fund}/fm-final").status_code == 404
    row = client.get(f"/api/portfolios/{fund}/analytics").json()["rows"][0]
    assert row["good_through"] is None

    # FM approves
    ok = client.post("/api/book-closes/2026-07/approve",
                     json={"approver": "FM Team"}).json()
    assert ok["status"] == "fm_approved"
    assert ok["approved_by"] == "FM Team"
    # no actuals on this deal -> engine close records the reason, not an error
    assert "no actuals" in ok["engine_closes"][deal]
    # double-approve blocked
    assert client.post("/api/book-closes/2026-07/approve").status_code == 409

    # good-through now flows into the live analytics
    row = client.get(f"/api/portfolios/{fund}/analytics").json()["rows"][0]
    assert row["good_through"] == "2026-07"
    assert row["mark_note"] == "widened 50bp on servicer transfer"
    assert row["mark_source"] == "book"

    # final portfolio view serves the frozen close
    final = client.get(f"/api/portfolios/{fund}/fm-final").json()
    assert final["close_month"] == "2026-07"
    assert final["approved_by"] == "FM Team"
    assert final["analytics"]["rows"][0]["deal"] == deal

    # load-source from the close
    src = client.post(f"/api/deals/{deal}/load-source",
                      json={"kind": "book_close", "ref": "2026-07"}).json()
    assert src["doc"]["meta"]["slug"] == deal
    assert "FM-approved" in src["origin"]

    # approved close needs force to delete
    assert client.delete("/api/book-closes/2026-07").status_code == 409
    assert client.delete("/api/book-closes/2026-07?force=true").status_code == 204


def test_close_timeline_flags_changes(client, deal, fund):
    client.put("/api/mark-book/entry", json={
        "deal": deal, "tranche": "A", "method": "spread", "schedule": {"0": 200}})
    assert client.post("/api/book-closes", json={"month": "2026-06"}).status_code == 201

    # change an assumption (repline cdr) + the mark, then close the next month
    doc = client.get(f"/api/deals/{deal}").json()
    doc["run"]["replines"][0]["inline"]["cdr"] = [0.05 / 12] * 361
    client.put(f"/api/deals/{deal}", json=doc)
    client.put("/api/mark-book/entry", json={
        "deal": deal, "tranche": "A", "method": "spread",
        "schedule": {"0": 275}, "note": "cdr revision"})
    assert client.post("/api/book-closes", json={"month": "2026-07"}).status_code == 201

    closes = client.get("/api/book-closes").json()["closes"]
    months = {c["month"]: c for c in closes}
    assert months["2026-06"]["has_changes"] is False
    july = months["2026-07"]
    assert july["has_changes"] is True
    assert deal in july["changes"]["replines"]
    assert deal in july["changes"]["marks"]
    assert july["changes"]["structure"] == []

    sources = client.get(f"/api/deals/{deal}/sources").json()
    assert [c["month"] for c in sources["book_closes"]] == ["2026-07", "2026-06"]

    for m in ("2026-06", "2026-07"):
        client.delete(f"/api/book-closes/{m}?force=true")
