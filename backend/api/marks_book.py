"""
ccflows-ui/backend/api/marks_book.py
Mark book endpoints: the matrix view (every held/known tranche with its book
mark, schedule, and holders), entry upserts, and bulk import.
"""

from typing import Any

from fastapi import APIRouter, Body, HTTPException

from core import mark_book, portfolio_store, workspace
from core.serialization import clean

router = APIRouter()


@router.get("/mark-book")
def get_mark_book() -> dict[str, Any]:
    """The matrix: one row per (deal, funded tranche) across the workspace,
    with book marks, actuals boundary, and which funds hold it."""
    book = mark_book.load()
    entries = book.get("entries") or {}

    holders: dict[tuple[str, str], list[str]] = {}
    for pf in portfolio_store.list_portfolios():
        try:
            doc = portfolio_store.load(pf["slug"])
        except (FileNotFoundError, ValueError):
            continue
        for p in doc.get("positions") or []:
            holders.setdefault((p["deal"], p["tranche"]), []).append(pf["slug"])

    rows: list[dict[str, Any]] = []
    for deal in workspace.list_deals():
        if deal.get("corrupt"):
            continue
        try:
            doc = workspace.load(deal["slug"])
        except FileNotFoundError:
            continue
        actuals = (doc.get("actuals") or {}).get("collateral") or []
        boundary = max((int(r.get("month") or 0) for r in actuals), default=0)
        for bond in (doc.get("waterfall") or {}).get("bonds") or []:
            if bond.get("type") not in ("bond", "io_strip", "wacio_strip"):
                continue
            tranche = bond["name"]
            entry = entries.get(deal["slug"], {}).get(tranche)
            resolved = mark_book.resolve(deal["slug"], tranche, boundary)
            rows.append({
                "deal": deal["slug"],
                "deal_name": deal["name"],
                "tranche": tranche,
                "floating": bool(bond.get("floating")),
                "boundary_month": boundary,
                "method": entry.get("method") if entry else None,
                "schedule": entry.get("schedule") if entry else None,
                "current_value": resolved[1] if resolved else None,
                "held_by": sorted(set(holders.get((deal["slug"], tranche), []))),
            })
    return clean({"rows": rows, "modified": (book.get("meta") or {}).get("modified")})


@router.put("/mark-book/entry")
def put_entry(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """{deal, tranche, method, schedule: {month: value}} — empty schedule deletes."""
    deal = str(body.get("deal") or "")
    tranche = str(body.get("tranche") or "")
    if not deal or not tranche:
        raise HTTPException(status_code=422, detail="deal and tranche are required")
    mark_book.upsert(deal, tranche, str(body.get("method") or "spread"),
                     body.get("schedule") or {})
    return {"ok": True}


@router.post("/mark-book/import")
def import_marks(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Bulk import: {rows: [{deal, tranche, value, month?, method?}]}.
    `deal` matches by slug or name; each row upserts one schedule point
    (existing points at other months are preserved)."""
    rows = body.get("rows") or []
    if not rows:
        raise HTTPException(status_code=422, detail="No rows")
    by_name = {d["name"].lower(): d["slug"] for d in workspace.list_deals()}
    slugs = {d["slug"] for d in workspace.list_deals()}

    applied, errors = 0, []
    book = mark_book.load()
    entries = book.setdefault("entries", {})
    for i, row in enumerate(rows):
        deal_key = str(row.get("deal") or "").strip()
        slug = deal_key if deal_key in slugs else by_name.get(deal_key.lower())
        tranche = str(row.get("tranche") or "").strip()
        try:
            value = float(row.get("value"))
            month = int(row.get("month") or 0)
        except (TypeError, ValueError):
            errors.append(f"row {i}: bad value/month")
            continue
        if not slug:
            errors.append(f"row {i}: unknown deal {deal_key!r}")
            continue
        if not tranche:
            errors.append(f"row {i}: missing tranche")
            continue
        entry = entries.setdefault(slug, {}).setdefault(
            tranche, {"method": "spread", "schedule": {}})
        if row.get("method") in ("spread", "dm", "yield"):
            entry["method"] = row["method"]
        entry["schedule"][str(month)] = value
        applied += 1
    mark_book.save(book)
    return clean({"applied": applied, "errors": errors})
