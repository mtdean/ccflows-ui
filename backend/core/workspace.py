"""
ccflows-ui/backend/core/workspace.py
Deal store: one {slug}.deal.json per deal under config.WORKSPACE_DIR.
Atomic writes (tmp + os.replace) so a crash never leaves a torn file.
"""

import json
import os
from pathlib import Path
from typing import Any

import config

from .document import DocumentError, check_structure, normalize, summary


def _path(slug: str) -> Path:
    if not slug or "/" in slug or slug.startswith("."):
        raise DocumentError(f"Invalid deal slug {slug!r}")
    return config.WORKSPACE_DIR / f"{slug}.deal.json"


def list_deals() -> list[dict[str, Any]]:
    rows = []
    for path in sorted(config.WORKSPACE_DIR.glob("*.deal.json")):
        try:
            rows.append(summary(json.loads(path.read_text())))
        except (json.JSONDecodeError, KeyError, TypeError):
            rows.append({"slug": path.name.removesuffix(".deal.json"), "name": path.name,
                         "modified": None, "tags": [], "n_replines": 0, "n_bonds": 0,
                         "total_upb": 0.0, "corrupt": True})
    rows.sort(key=lambda r: r.get("modified") or "", reverse=True)
    return rows


def exists(slug: str) -> bool:
    return _path(slug).is_file()


def load(slug: str) -> dict[str, Any]:
    path = _path(slug)
    if not path.is_file():
        raise FileNotFoundError(slug)
    return json.loads(path.read_text())


def save(doc: dict[str, Any]) -> dict[str, Any]:
    """Validate structure, normalize, atomically write. Returns the saved doc."""
    check_structure(doc)
    doc = normalize(doc)
    path = _path(doc["meta"]["slug"])
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, indent=1) + "\n")
    os.replace(tmp, path)
    return doc


def delete(slug: str) -> None:
    path = _path(slug)
    if not path.is_file():
        raise FileNotFoundError(slug)
    path.unlink()


def raw_path(slug: str) -> Path:
    """Path for download streaming; raises if missing."""
    path = _path(slug)
    if not path.is_file():
        raise FileNotFoundError(slug)
    return path
