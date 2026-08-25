"""Deal CRUD over the workspace folder + base-JSON import/download."""

import json


def test_crud_round_trip(client):
    doc = client.post("/api/deals", json={"name": "CRUD Deal"}).json()
    slug = doc["meta"]["slug"]
    assert slug == "crud-deal"

    listed = client.get("/api/deals").json()
    assert any(d["slug"] == slug for d in listed)

    doc["meta"]["notes"] = "hello"
    saved = client.put(f"/api/deals/{slug}", json=doc).json()
    assert saved["meta"]["notes"] == "hello"

    fetched = client.get(f"/api/deals/{slug}").json()
    assert fetched["meta"]["notes"] == "hello"

    assert client.delete(f"/api/deals/{slug}").status_code == 204
    assert client.get(f"/api/deals/{slug}").status_code == 404


def test_duplicate_slug_conflict(client):
    assert client.post("/api/deals", json={"name": "Dup Deal"}).status_code == 201
    assert client.post("/api/deals", json={"name": "Dup Deal"}).status_code == 409


def test_download_reimports_identically(client):
    doc = client.post("/api/deals", json={"name": "Round Trip"}).json()
    raw = client.get("/api/deals/round-trip/download").content
    parsed = json.loads(raw)
    assert parsed["meta"]["slug"] == doc["meta"]["slug"]
    assert client.post("/api/deals/import", content=raw).status_code == 409  # exists
    r = client.post("/api/deals/import?overwrite=true", content=raw)
    assert r.status_code == 201
    assert r.json()["run"]["replines"] == parsed["run"]["replines"]


def test_import_rejects_garbage(client):
    assert client.post("/api/deals/import", content=b"not json").status_code == 422
    assert client.post("/api/deals/import", json={"nope": 1}).status_code == 422


def test_no_tmp_residue(client):
    import config

    client.post("/api/deals", json={"name": "Atomic Deal"})
    assert not list(config.WORKSPACE_DIR.glob("*.tmp"))
