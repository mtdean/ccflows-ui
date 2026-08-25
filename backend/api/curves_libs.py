"""
ccflows-ui/backend/api/curves_libs.py
Curve libraries: named, reusable assumption-curve sets saved to the workspace
({slug}.curveslib.json). Each library records WHICH curves were explicitly
specified so applying one only touches those curves — deliberately avoiding
the engine's attach semantics (which resets unspecified curves to defaults
and passes ead/lgd through un-normalized).
"""

import json
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, HTTPException

import config
from core import engine_bridge
from core.document import DocumentError, slugify
from core.serialization import clean

router = APIRouter()

CURVES_SCHEMA = "ccflows-ui.curves/1"


def _path(slug: str):
    if not slug or "/" in slug or slug.startswith("."):
        raise DocumentError(f"Invalid curves slug {slug!r}")
    return config.WORKSPACE_DIR / f"{slug}.curveslib.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _summary(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "slug": doc["meta"]["slug"],
        "name": doc["meta"]["name"],
        "vintage": doc.get("vintage"),
        "asset_class": doc.get("asset_class"),
        "description": doc.get("description", ""),
        "specified": doc.get("specified") or [],
        "modified": doc["meta"].get("modified"),
    }


@router.get("/curves-libs")
def list_libs() -> list[dict[str, Any]]:
    rows = []
    for path in sorted(config.WORKSPACE_DIR.glob("*.curveslib.json")):
        try:
            rows.append(_summary(json.loads(path.read_text())))
        except (json.JSONDecodeError, KeyError, TypeError):
            rows.append({"slug": path.name.removesuffix(".curveslib.json"),
                         "name": path.name, "specified": [], "corrupt": True})
    rows.sort(key=lambda r: r.get("modified") or "", reverse=True)
    return rows


@router.get("/curves-libs/{slug}")
def get_lib(slug: str) -> dict[str, Any]:
    path = _path(slug)
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"No curve library '{slug}'")
    return json.loads(path.read_text())


@router.delete("/curves-libs/{slug}", status_code=204)
def delete_lib(slug: str) -> None:
    path = _path(slug)
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"No curve library '{slug}'")
    path.unlink()


def _save(doc: dict[str, Any]) -> dict[str, Any]:
    doc["meta"]["slug"] = slugify(doc["meta"]["name"])
    doc["meta"].setdefault("created", _now())
    doc["meta"]["modified"] = _now()
    path = _path(doc["meta"]["slug"])
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, indent=1) + "\n")
    os.replace(tmp, path)
    return doc


@router.post("/curves-libs/from-repline", status_code=201)
def from_repline(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """{doc, repline_id, name, vintage?, asset_class?, description?, overwrite?}
    Saves the repline's library curves; `specified` = the curve fields the
    repline entry explicitly carries in its inline dict."""
    from cashflows.dataclasses.field_registry import library_curve_names

    deal_doc = body.get("doc") or {}
    repline_id = str(body.get("repline_id") or "")
    name = str(body.get("name") or repline_id or "curves")
    entry = None
    for e in (deal_doc.get("run") or {}).get("replines") or []:
        if str((e.get("inline") or {}).get("repline_id")) == repline_id:
            entry = e
            break
    if entry is None:
        raise HTTPException(status_code=422, detail=f"No repline {repline_id!r} in deal")

    replines, _ = engine_bridge.build_replines(deal_doc)
    repline = next((r for r in replines if str(r.repline_id) == repline_id), None)
    if repline is None:
        raise HTTPException(status_code=422, detail=f"Repline {repline_id!r} failed to build")

    lib_names = set(library_curve_names())
    specified = sorted(n for n in (entry.get("inline") or {}) if n in lib_names)
    if not specified:
        raise HTTPException(status_code=422,
                            detail="This repline has no explicitly-set library curves")
    curves = {n: [float(x) for x in getattr(repline, n)] for n in specified}
    doc = {
        "schema": CURVES_SCHEMA,
        "meta": {"name": name, "slug": slugify(name)},
        "curves_id": slugify(name),
        "description": str(body.get("description") or f"Extracted from {repline_id}"),
        "vintage": body.get("vintage"),
        "asset_class": body.get("asset_class"),
        "specified": specified,
        "curves": curves,
    }
    if _path(doc["meta"]["slug"]).is_file() and not body.get("overwrite"):
        raise HTTPException(status_code=409,
                            detail=f"Library '{doc['meta']['slug']}' exists (pass overwrite)")
    return clean(_summary(_save(doc)))
