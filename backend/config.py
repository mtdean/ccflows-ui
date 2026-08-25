"""
ccflows-ui/backend/config.py
Paths and limits for the app. Env-overridable so tests can point the workspace
and export roots at temp directories.
"""

import json
import os
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ── workspace registry ──────────────────────────────────────────────────────
# Known deal folders + the active one, persisted OUTSIDE any workspace (in
# the user's home) so switching books survives repo moves. The
# CCFLOWS_WORKSPACE env var PINS the workspace and disables in-app switching
# (tests rely on this).

DEFAULT_WORKSPACE = ROOT / "workspace"
_registry_lock = threading.Lock()


def _registry_path() -> Path:
    home = Path(os.environ.get("CCFLOWS_HOME") or (Path.home() / ".ccflows-ui"))
    return home / "workspaces.json"


def env_pinned() -> bool:
    return "CCFLOWS_WORKSPACE" in os.environ


def load_registry() -> dict:
    path = _registry_path()
    if path.is_file():
        try:
            reg = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            reg = {}
    else:
        reg = {}
    known = [k for k in reg.get("known") or []
             if isinstance(k, dict) and k.get("path")]
    if not any(str(Path(k["path"])) == str(DEFAULT_WORKSPACE) for k in known):
        known.insert(0, {"name": "default", "path": str(DEFAULT_WORKSPACE)})
    return {"active": reg.get("active"), "known": known}


def save_registry(reg: dict) -> None:
    path = _registry_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with _registry_lock:
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(reg, indent=1) + "\n")
        os.replace(tmp, path)


def _initial_workspace() -> Path:
    if env_pinned():
        return Path(os.environ["CCFLOWS_WORKSPACE"]).expanduser().resolve()
    active = load_registry().get("active")
    return (Path(active) if active else DEFAULT_WORKSPACE).expanduser().resolve()


# Deal documents live here, one {slug}.deal.json per deal. Mutable — every
# store reads config.WORKSPACE_DIR at call time; switch_workspace repoints it.
WORKSPACE_DIR = _initial_workspace()


def switch_workspace(path: str) -> dict:
    """Repoint the app at another deal folder: build its skeleton, flush the
    engine caches, persist as active. Raises RuntimeError when env-pinned."""
    global WORKSPACE_DIR
    if env_pinned():
        raise RuntimeError(
            "Workspace is pinned by CCFLOWS_WORKSPACE — unset it to switch in-app")
    new = Path(path).expanduser().resolve()
    WORKSPACE_DIR = new
    ensure_dirs()
    reg = load_registry()
    if not any(str(Path(k["path"]).expanduser().resolve()) == str(new)
               for k in reg["known"]):
        reg["known"].append({"name": new.name, "path": str(new)})
    reg["active"] = str(new)
    save_registry(reg)
    # engine caches key off deal slugs — flush so nothing leaks across books
    from core import results_store, tracking  # late import — avoids a cycle
    from core.portfolio_store import clear_run_cache

    tracking.clear_cache()
    results_store.clear()
    clear_run_cache()
    return dirs_status()

# Default export target; individual export requests may override the folder.
EXPORT_DIR = Path(os.environ.get("CCFLOWS_EXPORTS", ROOT / "exports"))

# In-memory run results cache (results hold large numpy arrays; evicted -> 410).
RESULTS_CACHE_SIZE = int(os.environ.get("CCFLOWS_RESULTS_CACHE", "20"))

# Bounded executor so a stray triple-submit of Monte Carlo can't melt the machine.
JOB_MAX_WORKERS = int(os.environ.get("CCFLOWS_JOB_WORKERS", "2"))

# 8020 by default — situation-monitor conventionally holds 8000 on this machine.
PORT = int(os.environ.get("CCFLOWS_PORT", "8020"))


# Every folder the app writes into. Scenarios/closes live under the
# workspace; exports are per-deal subfolders created on demand.
WORKSPACE_SUBDIRS = ("scenarios", "book_closes", "closes")


def ensure_dirs() -> None:
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    for sub in WORKSPACE_SUBDIRS:
        (WORKSPACE_DIR / sub).mkdir(parents=True, exist_ok=True)


def dirs_status() -> dict:
    """The folder skeleton and whether each piece exists — the health check."""
    folders = {
        "workspace": WORKSPACE_DIR,
        "exports": EXPORT_DIR,
        **{f"workspace/{s}": WORKSPACE_DIR / s for s in WORKSPACE_SUBDIRS},
    }
    return {
        "root": str(ROOT),
        "folders": {name: {"path": str(p), "exists": p.is_dir()}
                    for name, p in folders.items()},
        "ok": all(p.is_dir() for p in folders.values()),
    }
