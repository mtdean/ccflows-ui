"""Health check: engine + the folder skeleton (built at startup, self-healed)."""

import shutil

import config


def test_health_reports_folder_skeleton(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    dirs = body["dirs"]
    assert dirs["ok"] is True
    expected = {"workspace", "exports"} | {f"workspace/{s}" for s in config.WORKSPACE_SUBDIRS}
    assert set(dirs["folders"]) == expected
    assert all(f["exists"] for f in dirs["folders"].values())


def test_health_self_heals_missing_subfolder(client):
    victim = config.WORKSPACE_DIR / "book_closes"
    shutil.rmtree(victim, ignore_errors=True)
    assert not victim.is_dir()
    body = client.get("/api/health").json()  # health rebuilds the skeleton
    assert victim.is_dir()
    assert body["dirs"]["ok"] is True
