"""
ccflows-ui/backend/api/validate.py
Stateless validation / live-preview endpoints. These never 4xx for domain
problems — they return {"ok": false, "errors": [...]} so the form UI can
attach messages to fields while the user types.
"""

import warnings
from typing import Any

from fastapi import APIRouter, Body

from cashflows.dataclasses.field_registry import REPLINE_FIELDS_BY_NAME
from cashflows.liabilities.spec import waterfall_from_dict
from cashflows.serialize.recipe import repline_from_dict
from cashflows.validation import ValidationError, validate_repline

from api.errors import engine_error_msg
from core.serialization import clean

router = APIRouter()


def _issue_field(message: str) -> str | None:
    """validate_repline returns strings that lead with the field name."""
    token = message.split(" ", 1)[0].strip(":,.")
    return token if token in REPLINE_FIELDS_BY_NAME else None


def _build_repline(data: dict[str, Any]) -> tuple[Any, list[dict], list[str]]:
    """Construct ReplineInputs from a doc dict, collecting errors + warnings."""
    errors: list[dict] = []
    warns: list[str] = []
    payload = dict(data)
    # strict mode: percent-looking curves are converted but *named* in a warning
    payload["percent_conversion"] = "strict"
    repline = None
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            repline = repline_from_dict(payload)
        warns.extend(str(w.message) for w in caught)
    except ValidationError as exc:
        errors.append({"loc": [exc.field] if exc.field else [], "field": exc.field,
                       "msg": str(exc).split("\n")[0], "hint": exc.hint})
    except (ValueError, TypeError) as exc:
        info = engine_error_msg(exc)
        errors.append({"loc": [], "field": None, "msg": info["msg"], "hint": info["hint"]})
    return repline, errors, warns


@router.post("/validate/repline")
def post_validate_repline(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    data = body.get("repline") or {}
    repline, errors, warns = _build_repline(data)
    if repline is not None:
        for message in validate_repline(repline):
            field = _issue_field(message)
            errors.append({"loc": [field] if field else [], "field": field,
                           "msg": message, "hint": None})
    return clean({"ok": not errors, "errors": errors, "warnings": warns})


def _build_waterfall(spec: dict[str, Any]):
    errors: list[dict] = []
    wf = None
    try:
        wf = waterfall_from_dict(spec)
    except KeyError as exc:
        errors.append({"loc": ["steps"], "field": None,
                       "msg": f"Unknown reference: {exc}", "hint":
                       "A step references a trigger or bond that is not defined."})
    except (ValueError, TypeError) as exc:
        info = engine_error_msg(exc)
        errors.append({"loc": [], "field": None, "msg": info["msg"], "hint": info["hint"]})
    return wf, errors


@router.post("/validate/waterfall")
def post_validate_waterfall(spec: dict[str, Any] = Body(...)) -> dict[str, Any]:
    wf, errors = _build_waterfall(spec)
    lint = wf.check() if wf is not None else []
    return clean({"ok": not errors, "errors": errors, "warnings": [], "lint": lint})


@router.post("/waterfall/mermaid")
def post_waterfall_mermaid(spec: dict[str, Any] = Body(...)) -> dict[str, Any]:
    wf, errors = _build_waterfall(spec)
    if wf is None:
        return clean({"ok": False, "errors": errors, "mermaid": None})
    return {"ok": True, "errors": [], "mermaid": wf.to_mermaid()}


@router.post("/waterfall/describe")
def post_waterfall_describe(spec: dict[str, Any] = Body(...)) -> dict[str, Any]:
    wf, errors = _build_waterfall(spec)
    if wf is None:
        return clean({"ok": False, "errors": errors, "text": None})
    return {"ok": True, "errors": [], "text": wf.describe()}


@router.post("/validate/deal")
def post_validate_deal(doc: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Aggregate per-section validation of a full deal document."""
    errors: list[dict] = []
    warns: list[str] = []

    replines = (doc.get("run") or {}).get("replines") or []
    if not replines:
        errors.append({"loc": ["run", "replines"], "field": None,
                       "msg": "At least one repline is required", "hint": None})
    for i, entry in enumerate(replines):
        repline, rep_errors, rep_warns = _build_repline(entry.get("inline") or {})
        prefix = ["run", "replines", i]
        for e in rep_errors:
            errors.append({**e, "loc": prefix + (e["loc"] or [])})
        warns.extend(f"repline[{i}]: {w}" for w in rep_warns)
        if repline is not None:
            for message in validate_repline(repline):
                field = _issue_field(message)
                errors.append({"loc": prefix + ([field] if field else []),
                               "field": field, "msg": message, "hint": None})

    wf_spec = doc.get("waterfall")
    lint: list[str] = []
    if wf_spec:
        wf, wf_errors = _build_waterfall(wf_spec)
        for e in wf_errors:
            errors.append({**e, "loc": ["waterfall"] + (e["loc"] or [])})
        if wf is not None:
            lint = wf.check()
    else:
        errors.append({"loc": ["waterfall"], "field": None,
                       "msg": "No waterfall structure defined", "hint": None})

    rates = doc.get("rates") or {}
    if rates.get("mode") == "flat":
        try:
            float(rates.get("rate"))
        except (TypeError, ValueError):
            errors.append({"loc": ["rates", "rate"], "field": "rate",
                           "msg": "Flat rate must be a number", "hint": None})
    elif rates.get("mode") == "records" and not rates.get("records"):
        errors.append({"loc": ["rates", "records"], "field": None,
                       "msg": "Rates records are empty", "hint": None})
    elif rates.get("mode") == "named":
        from core import rates_store

        slug = str(rates.get("curve") or "")
        if not slug or not rates_store.exists(slug):
            errors.append({"loc": ["rates", "curve"], "field": None,
                           "msg": f"Named rate curve {slug!r} not found in workspace",
                           "hint": "Create it under RATE CURVES on the Deals page"})
        else:
            cols = rates_store.columns_of(rates_store.load(slug))
            index = str(rates.get("index") or "sofr_1m")
            if index not in cols:
                errors.append({"loc": ["rates", "index"], "field": None,
                               "msg": f"Curve {slug!r} has no column {index!r} "
                                      f"(available: {', '.join(cols)})", "hint": None})

    return clean({"ok": not errors, "errors": errors, "warnings": warns, "lint": lint})
