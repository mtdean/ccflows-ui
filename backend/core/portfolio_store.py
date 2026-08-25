"""
ccflows-ui/backend/core/portfolio_store.py
Portfolio documents: one {slug}.portfolio.json per fund under the workspace,
positions = (deal slug, tranche, face, cost basis). Same atomic-write pattern
as deals. Also holds the hash-keyed base-run cache that powers the
auto-rerun-on-view portfolio analytics.
"""

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import config

from .document import DocumentError, slugify

PORTFOLIO_SCHEMA = "ccflows-ui.portfolio/1"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _path(slug: str) -> Path:
    if not slug or "/" in slug or slug.startswith("."):
        raise DocumentError(f"Invalid portfolio slug {slug!r}")
    return config.WORKSPACE_DIR / f"{slug}.portfolio.json"


def new_portfolio(name: str) -> dict[str, Any]:
    return {
        "schema": PORTFOLIO_SCHEMA,
        "meta": {"name": name, "slug": slugify(name), "notes": "",
                 "created": _now(), "modified": _now()},
        "positions": [],
        "marks": {"method": "spread", "default": 200.0, "per_tranche": {}},
    }


def check_structure(doc: Any) -> None:
    if not isinstance(doc, dict):
        raise DocumentError("Portfolio document must be a JSON object")
    if doc.get("schema") != PORTFOLIO_SCHEMA:
        raise DocumentError(
            f"Unsupported portfolio schema {doc.get('schema')!r} (want {PORTFOLIO_SCHEMA!r})",
            ["schema"])
    if not isinstance(doc.get("meta"), dict) or not doc["meta"].get("name"):
        raise DocumentError("meta.name is required", ["meta", "name"])
    positions = doc.get("positions")
    if not isinstance(positions, list):
        raise DocumentError("positions must be a list", ["positions"])
    for i, p in enumerate(positions):
        if not isinstance(p, dict):
            raise DocumentError("position must be an object", ["positions", i])
        for key in ("deal", "tranche"):
            if not p.get(key):
                raise DocumentError(f"position needs '{key}'", ["positions", i, key])
        try:
            if float(p.get("face", 0)) <= 0:
                raise DocumentError("face must be > 0", ["positions", i, "face"])
            if float(p.get("cost_basis", 0)) < 0:
                raise DocumentError("cost_basis must be >= 0", ["positions", i, "cost_basis"])
            if float(p.get("commitment") or 0) < 0:
                raise DocumentError("commitment must be >= 0", ["positions", i, "commitment"])
        except (TypeError, ValueError) as exc:
            raise DocumentError(f"bad number in position: {exc}", ["positions", i]) from exc
    marks = doc.get("marks")
    if marks is not None and not isinstance(marks, dict):
        raise DocumentError("marks must be an object", ["marks"])


def list_portfolios() -> list[dict[str, Any]]:
    rows = []
    for path in sorted(config.WORKSPACE_DIR.glob("*.portfolio.json")):
        try:
            doc = json.loads(path.read_text())
            rows.append({
                "slug": doc["meta"]["slug"],
                "name": doc["meta"]["name"],
                "modified": doc["meta"].get("modified"),
                "n_positions": len(doc.get("positions") or []),
                "deals": sorted({p["deal"] for p in doc.get("positions") or []}),
            })
        except (json.JSONDecodeError, KeyError, TypeError):
            rows.append({"slug": path.name.removesuffix(".portfolio.json"),
                         "name": path.name, "modified": None, "n_positions": 0,
                         "deals": [], "corrupt": True})
    rows.sort(key=lambda r: r.get("modified") or "", reverse=True)
    return rows


def exists(slug: str) -> bool:
    return _path(slug).is_file()


def load(slug: str) -> dict[str, Any]:
    path = _path(slug)
    if not path.is_file():
        raise FileNotFoundError(f"portfolio {slug}")
    return json.loads(path.read_text())


def save(doc: dict[str, Any]) -> dict[str, Any]:
    check_structure(doc)
    doc.setdefault("marks", {"method": "spread", "default": 200.0, "per_tranche": {}})
    doc["meta"]["slug"] = slugify(doc["meta"]["name"])
    doc["meta"].setdefault("created", _now())
    doc["meta"]["modified"] = _now()
    path = _path(doc["meta"]["slug"])
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, indent=1) + "\n")
    os.replace(tmp, path)
    return doc


def delete(slug: str) -> None:
    path = _path(slug)
    if not path.is_file():
        raise FileNotFoundError(f"portfolio {slug}")
    path.unlink()


# ── base-run cache for portfolio analytics ─────────────────────────────────
# {deal_slug: (doc_hash, run_at_iso, DealRun)} — deliberately separate from the
# run_id LRU: portfolio views hit the same deals repeatedly and key by content.

_cache_lock = threading.Lock()
_run_cache: dict[str, tuple[str, str, Any]] = {}


def doc_run_hash(doc: dict[str, Any]) -> str:
    payload = json.dumps({"run": doc.get("run"), "waterfall": doc.get("waterfall"),
                          "rates": doc.get("rates")}, sort_keys=True)
    import hashlib

    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def cached_base_run(slug: str, doc: dict[str, Any]) -> tuple[Any, bool, str]:
    """Return (DealRun, reran, run_at) for the deal's base case, re-running
    only when the doc's run-relevant content changed."""
    from . import engine_bridge

    h = doc_run_hash(doc)
    with _cache_lock:
        hit = _run_cache.get(slug)
        if hit is not None and hit[0] == h:
            return hit[2], False, hit[1]
    run = engine_bridge.run_deal(doc, scenario="base")
    at = _now()
    with _cache_lock:
        _run_cache[slug] = (h, at, run)
    return run, True, at
