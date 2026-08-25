"""
ccflows-ui/backend/api/actuals.py
Remittance / actuals: validate uploaded tapes against the engine's schema and
run the model-vs-actual redline backtest. The tapes themselves live in the
deal document (doc.actuals.collateral / doc.actuals.bonds) and are spliced
ahead of projections automatically on every run.
"""

from typing import Any

import pandas as pd
from fastapi import APIRouter, Body, HTTPException

from cashflows.actuals import RemittanceData, redline
from cashflows.actuals.deal_tracking import BondRemittanceData

from core import engine_bridge
from core.serialization import clean, df_records

router = APIRouter()

COLLATERAL_REQUIRED = ["repline_id", "month", "upb_end", "interest_collected",
                       "principal_collected", "prepayments", "chargeoffs", "recoveries"]
COLLATERAL_OPTIONAL = ["fees_collected", "dq_30", "dq_60", "dq_90", "dq_120", "dq_150", "dq_180"]
BOND_REQUIRED = ["tranche", "month", "balance_end", "interest_paid", "principal_paid"]
BOND_OPTIONAL = ["interest_shortfall", "oc_ratio", "ic_ratio"]


@router.get("/schema/actuals")
def actuals_schema() -> dict[str, Any]:
    """Column contract for the two tapes — drives the CSV template + mapper."""
    return {
        "collateral": {"required": COLLATERAL_REQUIRED, "optional": COLLATERAL_OPTIONAL,
                       "notes": {
                           "month": "Month-on-book integer; month 0 = the run date",
                           "principal_collected": "Scheduled principal only — excludes prepayments",
                           "chargeoffs": "Gross chargeoffs (net loss = chargeoffs - recoveries)",
                           "dq_*": "Delinquency balances in dollars, not rates",
                       }},
        "bonds": {"required": BOND_REQUIRED, "optional": BOND_OPTIONAL,
                  "notes": {"balance_end": "Trustee-reported end-of-month bond balance"}},
    }


@router.post("/validate/actuals")
def validate_actuals(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """{level: 'collateral'|'bonds', records: [...]} -> ok/errors + coverage."""
    level = str(body.get("level") or "collateral")
    records = body.get("records") or []
    if not records:
        return {"ok": False, "errors": [{"loc": ["records"], "field": None,
                                         "msg": "No rows", "hint": None}], "warnings": []}
    df = pd.DataFrame(records)
    try:
        if level == "bonds":
            tape = BondRemittanceData(df)
            ids = sorted(df["tranche"].unique().tolist())
        else:
            tape = RemittanceData(df)
            ids = sorted(tape.repline_ids)
    except (ValueError, KeyError) as exc:
        return clean({"ok": False, "errors": [{"loc": [], "field": None,
                                               "msg": str(exc), "hint": None}], "warnings": []})
    months = sorted(df["month"].unique().tolist())
    return clean({
        "ok": True, "errors": [], "warnings": [],
        "ids": ids,
        "months": {"first": min(months), "last": max(months), "count": len(months)},
        "n_rows": len(df),
    })


@router.post("/actuals/redline")
def post_redline(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Model-vs-actual backtest over the deal doc's collateral tape."""
    doc = body.get("doc") or {}
    rows = (doc.get("actuals") or {}).get("collateral") or []
    if not rows:
        raise HTTPException(status_code=422, detail="Deal has no collateral actuals")

    replines, _ = engine_bridge.build_replines(doc)
    run_date = str((doc.get("run") or {}).get("run_date") or "2026-01-01")
    if ((doc.get("run") or {}).get("originations") or {}).get("schedule"):
        raise HTTPException(status_code=422,
                            detail="Redline is not supported on forward-flow origination pools")
    _, models, _ = engine_bridge.run_collateral(replines, doc.get("rates"), run_date)
    if len(models) > 1:
        raise HTTPException(status_code=422,
                            detail="Redline needs a single collateral engine type")

    try:
        report = redline(models[0], RemittanceData(pd.DataFrame(rows)))
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    summary = report.summary()
    if isinstance(summary, pd.DataFrame):
        summary_payload: Any = df_records(summary)
    elif isinstance(summary, pd.Series):
        summary_payload = dict(summary)
    else:
        summary_payload = summary

    details = {}
    for field in ("upb_end", "chargeoffs", "interest_collected", "prepayments"):
        try:
            detail = report.detail(field)
            details[field] = df_records(detail.reset_index())
        except (KeyError, ValueError):
            continue

    return clean({"summary": summary_payload, "details": details})
