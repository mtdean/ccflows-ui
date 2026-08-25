"""Workspace switcher: registry, env pinning, cache flush, skeleton build."""

import config


def test_pinned_env_blocks_switching(client, tmp_path):
    # conftest pins CCFLOWS_WORKSPACE — switching must refuse
    r = client.post("/api/workspaces/switch", json={"path": str(tmp_path / "b")})
    assert r.status_code == 409
    assert client.get("/api/workspaces").json()["pinned"] is True


def test_switch_between_books(client, monkeypatch, tmp_path):
    monkeypatch.setenv("CCFLOWS_HOME", str(tmp_path / "home"))
    original = config.WORKSPACE_DIR
    monkeypatch.delenv("CCFLOWS_WORKSPACE")
    try:
        assert client.post("/api/deals", json={"name": "Book A Deal"}).status_code == 201

        book_b = tmp_path / "book-b"
        r = client.post("/api/workspaces/switch", json={"path": str(book_b)})
        assert r.status_code == 200, r.text
        assert r.json()["dirs"]["ok"] is True
        assert (book_b / "book_closes").is_dir()  # skeleton built
        assert client.get("/api/deals").json() == []  # other book is empty

        ws = client.get("/api/workspaces").json()
        assert ws["pinned"] is False
        active = [k for k in ws["known"] if k["active"]]
        assert len(active) == 1 and active[0]["path"] == str(book_b.resolve())

        # switch back — book A's deal is still there
        assert client.post("/api/workspaces/switch",
                           json={"path": str(original)}).status_code == 200
        slugs = [d["slug"] for d in client.get("/api/deals").json()]
        assert "book-a-deal" in slugs
        client.delete("/api/deals/book-a-deal")
    finally:
        config.WORKSPACE_DIR = original
        config.ensure_dirs()


def test_add_and_forget(client, monkeypatch, tmp_path):
    monkeypatch.setenv("CCFLOWS_HOME", str(tmp_path / "home"))
    other = tmp_path / "other-book"
    r = client.post("/api/workspaces", json={"path": str(other), "name": "Other"})
    assert r.status_code == 201
    assert r.json()["exists"] is False  # remembered, not created
    assert client.post("/api/workspaces",
                       json={"path": str(other)}).status_code == 409  # dupe
    assert client.delete(f"/api/workspaces?path={other}").status_code == 204
    names = [k["name"] for k in client.get("/api/workspaces").json()["known"]]
    assert "Other" not in names
    # the active workspace can't be forgotten
    active = str(config.WORKSPACE_DIR)
    assert client.delete(f"/api/workspaces?path={active}").status_code == 409
