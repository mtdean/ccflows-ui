"""
ccflows-ui/backend/core/rates_store.py
Named rate curves: one {slug}.rates.json per curve set under the workspace.
A curve set may carry multiple index columns (sofr_1m, sofr_3m, prime...);
deals reference one by slug + index column. Built from flat rates, month-point
curves, CSV uploads, or a live Pensford forward-curve fetch — and, later, a
Bloomberg feed posting the same records shape.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

import config

from .document import DocumentError, slugify

RATES_SCHEMA = "ccflows-ui.rates/1"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _path(slug: str) -> Path:
    if not slug or "/" in slug or slug.startswith("."):
        raise DocumentError(f"Invalid rates slug {slug!r}")
    return config.WORKSPACE_DIR / f"{slug}.rates.json"


def check_structure(doc: Any) -> None:
    if not isinstance(doc, dict):
        raise DocumentError("Rates document must be a JSON object")
    if doc.get("schema") != RATES_SCHEMA:
        raise DocumentError(f"Unsupported rates schema {doc.get('schema')!r}", ["schema"])
    if not isinstance(doc.get("meta"), dict) or not doc["meta"].get("name"):
        raise DocumentError("meta.name is required", ["meta", "name"])
    records = doc.get("records")
    if not isinstance(records, list) or not records:
        raise DocumentError("records must be a non-empty list", ["records"])
    for i, r in enumerate(records[:3]):
        if not isinstance(r, dict) or "date" not in r:
            raise DocumentError("each record needs a 'date'", ["records", i])


def columns_of(doc: dict[str, Any]) -> list[str]:
    cols: list[str] = []
    for r in doc.get("records") or []:
        for k in r:
            if k != "date" and k not in cols:
                cols.append(k)
    return cols


def summary(doc: dict[str, Any]) -> dict[str, Any]:
    records = doc.get("records") or []
    dates = sorted(str(r.get("date")) for r in records)
    return {
        "slug": doc["meta"]["slug"],
        "name": doc["meta"]["name"],
        "source": doc["meta"].get("source"),
        "modified": doc["meta"].get("modified"),
        "columns": columns_of(doc),
        "n_rows": len(records),
        "first_date": dates[0] if dates else None,
        "last_date": dates[-1] if dates else None,
    }


def list_curves() -> list[dict[str, Any]]:
    rows = []
    for path in sorted(config.WORKSPACE_DIR.glob("*.rates.json")):
        try:
            rows.append(summary(json.loads(path.read_text())))
        except (json.JSONDecodeError, KeyError, TypeError):
            rows.append({"slug": path.name.removesuffix(".rates.json"), "name": path.name,
                         "columns": [], "n_rows": 0, "corrupt": True})
    rows.sort(key=lambda r: r.get("modified") or "", reverse=True)
    return rows


def exists(slug: str) -> bool:
    return _path(slug).is_file()


def load(slug: str) -> dict[str, Any]:
    path = _path(slug)
    if not path.is_file():
        raise FileNotFoundError(f"rates curve {slug}")
    return json.loads(path.read_text())


def save(doc: dict[str, Any]) -> dict[str, Any]:
    check_structure(doc)
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
        raise FileNotFoundError(f"rates curve {slug}")
    path.unlink()


def to_dataframe(slug: str) -> pd.DataFrame:
    """Named curve -> engine-ready rates DataFrame (all columns kept)."""
    from cashflows.serialize.recipe import rates_from_records

    return rates_from_records(load(slug)["records"])


def from_dataframe(name: str, df: pd.DataFrame, source: str) -> dict[str, Any]:
    from cashflows.serialize.recipe import rates_to_records

    return {
        "schema": RATES_SCHEMA,
        "meta": {"name": name, "slug": slugify(name), "source": source,
                 "fetched_at": _now(), "notes": ""},
        "records": rates_to_records(df),
    }
