"""Exports: standardized naming, folder placement, download variant."""

import re
from pathlib import Path

NAME_RE = re.compile(r"^\d{8}_\d{6}_[a-z0-9_]+_[a-z0-9_]+\.(xlsx|csv|json)$")


def _run(client, deal_doc):
    r = client.post("/api/deals/fixture-deal/run", json={"doc": deal_doc, "scenario": "base"})
    assert r.status_code == 200
    return r.json()["run_id"]


def test_export_naming_and_folder(client, deal_doc):
    import config

    rid = _run(client, deal_doc)
    res = client.post(f"/api/runs/{rid}/export",
                      json={"format": "csv", "artifact": "stack"}).json()
    path = Path(res["path"])
    assert path.exists()
    assert NAME_RE.match(path.name), path.name
    assert path.parent == config.EXPORT_DIR / "fixture-deal"
    listed = client.get("/api/deals/fixture-deal/exports").json()
    assert any(row["filename"] == path.name for row in listed)


def test_export_xlsx_workbook(client, deal_doc):
    rid = _run(client, deal_doc)
    res = client.post(f"/api/runs/{rid}/export",
                      json={"format": "xlsx", "artifact": "deal"}).json()
    assert Path(res["path"]).stat().st_size > 5000


def test_download_streams(client, deal_doc):
    rid = _run(client, deal_doc)
    r = client.get(f"/api/runs/{rid}/export/download?format=csv&artifact=stack")
    assert r.status_code == 200
    assert b"tranche" in r.content


def test_bad_artifact_422(client, deal_doc):
    rid = _run(client, deal_doc)
    assert client.post(f"/api/runs/{rid}/export",
                       json={"format": "csv", "artifact": "nope"}).status_code == 422
