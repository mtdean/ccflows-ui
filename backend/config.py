"""
ccflows-ui/backend/config.py
Paths and limits for the app. Env-overridable so tests can point the workspace
and export roots at temp directories.
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Deal documents live here, one {slug}.deal.json per deal.
WORKSPACE_DIR = Path(os.environ.get("CCFLOWS_WORKSPACE", ROOT / "workspace"))

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
