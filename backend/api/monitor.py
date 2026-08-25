"""
ccflows-ui/backend/api/monitor.py
Deal-monitoring endpoints over the TrackedDeal layer: status board, covenant
reports, surveillance flags, bond redline, spliced tranche series, and the
actual-vs-projected performance series that powers the remittance charts.
All POST endpoints accept {doc} so they work on the current draft.
"""

from typing import Any

import numpy as np
from fastapi import APIRouter, Body, HTTPException

from core import tracking, workspace
from core.serialization import clean, df_records
from core.tracking import TrackingError

router = APIRouter()


def _doc(slug: str, body: dict[str, Any]) -> dict[str, Any]:
    return body.get("doc") or workspace.load(slug)


def _tracked(slug: str, body: dict[str, Any]):
    try:
        return tracking.get_tracked(slug, _doc(slug, body))
    except TrackingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _spliced(tracked):
    """Deal splice with engine data-consistency errors surfaced as 422s."""
    try:
        return tracked.spliced()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


COVENANT_SCHEMAS = [
    {"factory": "max_cnl", "label": "Max cumulative net loss", "direction": "max",
     "level": "collateral", "doc": "Cumulative net losses / original pool balance stays under the limit.",
     "params": [{"name": "limit", "kind": "float", "default": 0.06, "doc": "CNL cap, decimal"}]},
    {"factory": "max_chargeoff_rate", "label": "Max charge-off rate", "direction": "max",
     "level": "collateral", "doc": "Trailing-average annualized charge-off rate stays under the limit.",
     "params": [{"name": "limit", "kind": "float", "default": 0.08, "doc": "Annualized rate cap, decimal"},
                {"name": "trailing", "kind": "int", "default": 3, "doc": "Trailing months"}]},
    {"factory": "max_dq_ratio", "label": "Max delinquency ratio", "direction": "max",
     "level": "collateral", "doc": "Delinquency balance / pool balance stays under the limit.",
     "params": [{"name": "limit", "kind": "float", "default": 0.05},
                {"name": "bucket", "kind": "enum", "default": "dq_60",
                 "choices": ["dq_30", "dq_60", "dq_90", "dq_120", "dq_150", "dq_180"]},
                {"name": "trailing", "kind": "int", "default": 1}]},
    {"factory": "min_excess_spread", "label": "Min excess spread", "direction": "min",
     "level": "financial", "doc": "Trailing annualized excess spread stays above the floor.",
     "params": [{"name": "floor", "kind": "float", "default": 0.03},
                {"name": "cost_rate", "kind": "float", "default": 0.0, "doc": "Annual cost drag, decimal"},
                {"name": "trailing", "kind": "int", "default": 3}]},
    {"factory": "min_oc", "label": "Min OC ratio", "direction": "min",
     "level": "deal", "doc": "Trustee-reported OC ratio stays above the trigger (needs bond tape).",
     "params": [{"name": "trigger", "kind": "float", "default": 1.10}]},
    {"factory": "min_ic", "label": "Min IC ratio", "direction": "min",
     "level": "deal", "doc": "Trustee-reported IC ratio stays above the trigger (needs bond tape).",
     "params": [{"name": "trigger", "kind": "float", "default": 1.05}]},
    {"factory": "min_pool_factor", "label": "Min pool factor", "direction": "min",
     "level": "collateral", "doc": "Pool balance / original balance stays above the floor.",
     "params": [{"name": "floor", "kind": "float", "default": 0.05}]},
]

COMMON_COVENANT_FIELDS = [
    {"name": "severity", "kind": "enum", "choices": ["watch", "alert", "breach"], "default": "breach"},
    {"name": "grace_months", "kind": "int", "default": 1,
     "doc": "Consecutive violating months before TRIPPED"},
    {"name": "cure_months", "kind": "int", "default": 1,
     "doc": "Consecutive clean months to cure"},
]


@router.get("/schema/covenants")
def covenant_schema() -> dict[str, Any]:
    return {"factories": COVENANT_SCHEMAS, "common": COMMON_COVENANT_FIELDS}


@router.post("/deals/{slug}/monitor/overview")
def monitor_overview(slug: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    tracked = _tracked(slug, body)
    status = tracked.status()
    payload: dict[str, Any] = {"status": status}
    try:
        payload["bond_status"] = df_records(tracked.bond_status())
    except Exception:  # noqa: BLE001 — no bond data is a legitimate state
        payload["bond_status"] = {"columns": [], "records": []}
    try:
        payload["realized"] = tracked.spliced().collateral.realized_metrics()
    except Exception:  # noqa: BLE001
        payload["realized"] = None
    return clean(payload)


@router.post("/deals/{slug}/monitor/covenants")
def monitor_covenants(slug: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    tracked = _tracked(slug, body)
    doc = _doc(slug, body)
    if not (doc.get("covenants") or []):
        return {"summary": {"columns": [], "records": []}, "details": {}, "all_clear": True}
    if not tracking.has_actuals(doc):
        raise HTTPException(status_code=422,
                            detail="Covenants evaluate against actuals — load a tape first")
    try:
        report = tracked.covenant_report()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    details = {}
    for name in report.names:
        details[name] = df_records(report.detail(name))
    return clean({
        "summary": df_records(report.summary()),
        "details": details,
        "all_clear": report.all_clear,
        "breached": report.breached,
    })


@router.post("/deals/{slug}/monitor/surveillance")
def monitor_surveillance(slug: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    tracked = _tracked(slug, body)
    if not tracking.has_actuals(_doc(slug, body)):
        raise HTTPException(status_code=422,
                            detail="Surveillance needs actuals — load a tape first")
    report = tracked.surveillance()
    return clean({
        "flags": df_records(report.flags()),
        "summary": df_records(report.summary()),
        "all_clear": report.all_clear,
    })


@router.post("/deals/{slug}/monitor/bond-redline")
def monitor_bond_redline(slug: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    tracked = _tracked(slug, body)
    doc = _doc(slug, body)
    if not ((doc.get("actuals") or {}).get("bonds") or []):
        raise HTTPException(status_code=422, detail="No bond (trustee) tape loaded")
    report = tracked.redline(side="bonds")
    details = {}
    for field in ("balance_end", "interest_paid", "principal_paid"):
        try:
            details[field] = df_records(report.detail(field))
        except (KeyError, ValueError):
            continue
    return clean({"summary": df_records(report.summary()), "details": details})


@router.post("/deals/{slug}/monitor/tranche-series")
def monitor_tranche_series(slug: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """Per-tranche spliced time series: actual months (trustee-overridden)
    followed by the re-seeded projection."""
    tracked = _tracked(slug, body)
    spliced = _spliced(tracked)
    df = spliced.to_dataframe()
    # trim the dead tail for the wire
    live = df[df["tranche_balance_end"].fillna(0) > 1]["month"]
    last = int(live.max()) + 2 if len(live) else 24
    return clean({
        "boundary_month": int(spliced.boundary_month),
        "tranches": spliced.tranche_names,
        "series": df_records(df[df["month"] <= last]),
        "realized": df_records(spliced.realized_metrics()),
        "forward": df_records(spliced.forward_metrics()),
    })


@router.post("/deals/{slug}/monitor/pnl")
def monitor_pnl(slug: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """Time-series P&L per tranche: fair-value statements with roll-forwards.
    body: {doc?, spreads: number|{tranche: bps}, method?, freq: M|Q|A}"""
    tracked = _tracked(slug, body)
    doc = _doc(slug, body)
    if not tracking.has_actuals(doc):
        raise HTTPException(status_code=422,
                            detail="P&L statements need actuals — load a tape first")
    spreads = body.get("spreads", 0.0)
    freq = str(body.get("freq") or "M")
    if freq not in ("M", "Q", "A"):
        raise HTTPException(status_code=422, detail="freq must be M, Q, or A")
    spread_arg = spreads if isinstance(spreads, (int, float)) else dict(spreads)
    statements: dict[str, Any] = {}
    skipped: dict[str, str] = {}
    for name in tracked.tranche_names:
        try:
            statements[name] = tracked.pnl(spread_arg, tranche=name)
        except (ValueError, KeyError, TypeError) as exc:
            skipped[name] = str(exc)  # e.g. zero-balance residuals
    if not statements:
        raise HTTPException(status_code=422,
                            detail="; ".join(f"{k}: {v}" for k, v in skipped.items())
                            or "No tranches could produce a P&L statement")

    out = {}
    for name, stmt in statements.items():
        monthly = stmt.monthly()
        out[name] = {
            "rollforward": df_records(stmt.rollforward(freq)),
            "summary": stmt.summary(),
            "price_series": df_records(
                monthly[["month", "is_actual", "clean_price", "balance", "ending_mv"]]),
        }
    return clean({"freq": freq, "statements": out, "skipped": skipped})


CLOSES_DIRNAME = "closes"


def _close_store():
    import config
    from cashflows import CloseStore

    return CloseStore(config.WORKSPACE_DIR / CLOSES_DIRNAME)


@router.post("/deals/{slug}/close")
def close_month(slug: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """Sign off a month: marks + P&L + covenant/surveillance/redline summaries,
    frozen with an input fingerprint. Operates on the SAVED deal only."""
    doc = workspace.load(slug)  # closes are sign-offs — never on a draft
    if not tracking.has_actuals(doc):
        raise HTTPException(status_code=422, detail="Nothing to close — no actuals loaded")
    try:
        tracked = tracking.get_tracked(slug, doc)
    except TrackingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    spreads = body.get("spreads", 0.0)
    try:
        snapshot = tracked.close_month(
            month=body.get("month"),
            spreads=spreads if isinstance(spreads, (int, float)) else dict(spreads),
            store=_close_store(),
            notes=str(body.get("notes") or ""),
            overwrite=bool(body.get("overwrite")),
            amendment_note=body.get("amendment_note"),
        )
    except FileExistsError as exc:
        raise HTTPException(status_code=409,
                            detail="Month already closed — pass overwrite with an "
                                   "amendment note to restate") from exc
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return clean(snapshot.to_dict())


@router.get("/deals/{slug}/closes")
def list_closes(slug: str) -> dict[str, Any]:
    store = _close_store()
    doc = workspace.load(slug)
    name = doc["meta"]["slug"]
    try:
        if name not in store.assets():
            return {"history": {"columns": [], "records": []}}
        return clean({"history": df_records(store.history(name))})
    except (FileNotFoundError, KeyError):
        return {"history": {"columns": [], "records": []}}


@router.post("/deals/{slug}/closes/{month}/drift")
def close_drift(slug: str, month: int) -> dict[str, Any]:
    doc = workspace.load(slug)
    store = _close_store()
    try:
        snapshot = store.load(doc["meta"]["slug"], month)
    except (FileNotFoundError, KeyError) as exc:
        raise HTTPException(status_code=404, detail=f"No close for month {month}") from exc
    try:
        tracked = tracking.get_tracked(slug, doc)
        drift = tracked.drift_check(snapshot)
    except TrackingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return clean({"clean": drift.empty, "rows": df_records(drift)})


@router.post("/deals/{slug}/monitor/performance-series")
def monitor_performance_series(slug: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """Actual vs projected CDR/CPR (annualized, same base on both sides),
    pool factor, and monthly dollar variances — the remittance chart payload."""
    tracked = _tracked(slug, body)
    doc = _doc(slug, body)
    if not ((doc.get("actuals") or {}).get("collateral") or []):
        raise HTTPException(status_code=422, detail="No collateral tape loaded")

    ctx = tracked._covenant_context()  # noqa: SLF001 — engine-stable, used by its tests
    actual_cdr = ctx.annualized_chargeoff_rate()
    actual_cpr = ctx.annualized_prepay_rate()
    actual_pool = ctx.series("pool_balance")
    original = float(ctx.original_balance())

    model = tracked.model
    upb_start = np.asarray(model.upb_start, dtype=float).sum(axis=0)
    with np.errstate(divide="ignore", invalid="ignore"):
        proj_mdr = np.where(upb_start > 0, np.asarray(model.upb_chargeoff).sum(axis=0) / upb_start, 0.0)
        proj_smm = np.where(upb_start > 0, np.asarray(model.upb_prepay).sum(axis=0) / upb_start, 0.0)
    proj_cdr = 1.0 - (1.0 - np.clip(proj_mdr, 0, 1)) ** 12
    proj_cpr = 1.0 - (1.0 - np.clip(proj_smm, 0, 1)) ** 12
    model_pool = np.asarray(model.upb_end, dtype=float).sum(axis=0)

    boundary = int(_spliced(tracked).boundary_month)
    horizon = min(len(proj_cdr), max(boundary + 25, 36))
    months = list(range(1, horizon))
    rows = []
    for m in months:
        rows.append({
            "month": m,
            "actual_cdr": float(actual_cdr[m]) if m in actual_cdr.index else None,
            "projected_cdr": float(proj_cdr[m]),
            "actual_cpr": float(actual_cpr[m]) if m in actual_cpr.index else None,
            "projected_cpr": float(proj_cpr[m]),
            "actual_factor": (float(actual_pool[m]) / original
                              if m in actual_pool.index and original > 0 else None),
            "model_factor": float(model_pool[m]) / original if original > 0 else None,
        })

    # monthly dollar variances from the collateral redline
    dollars: dict[str, Any] = {}
    try:
        redline_report = tracked.redline(side="collateral")
        for field in ("chargeoffs", "prepayments", "interest_collected"):
            detail = redline_report.detail(field)
            agg = detail.groupby("month")[["actual", "model"]].sum().reset_index()
            dollars[field] = df_records(agg)
    except Exception:  # noqa: BLE001
        dollars = {}

    return clean({"boundary_month": boundary, "rows": rows, "dollars": dollars})
