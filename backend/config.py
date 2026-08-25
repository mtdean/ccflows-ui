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


def ensure_dirs() -> None:
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
