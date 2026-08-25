"""
ccflows-ui/backend/api/analysis.py
Pricing & valuation analysis on a completed run: tranche pricing at a user
yield / DM / spread / custom zero curve, yield & price tables, per-repline
loan pricing, and full-deal marks.
"""

import datetime as dt
from typing import Any

import numpy as np
from fastapi import APIRouter, Body, HTTPException, Query

from cashflows import DiscountCurve, mark_deal, mark_tranche

from core import results_store
from core.results_store import RunRecord
from core.serialization import clean, df_records

router = APIRouter()


def _record_or_410(run_id: str) -> RunRecord:
    record = results_store.get(run_id)
    if record is None:
        raise HTTPException(status_code=410, detail="Run expired — re-run the deal")
    return record


def _bond_specs(record: RunRecord) -> list[dict[str, Any]]:
    return [b for b in record.waterfall_spec.get("bonds", [])]


def _tranche_index(record: RunRecord, name: str) -> int:
    names = [b["name"] for b in _bond_specs(record)]
    if name not in names:
        raise HTTPException(status_code=404, detail=f"No tranche named {name!r}")
    return names.index(name)


@router.get("/runs/{run_id}/analysis/tranches")
def get_analysis_tranches(run_id: str) -> dict[str, Any]:
    """Pricing context per tranche: name, kind, fixed/floating, coupon/margin."""
    record = _record_or_410(run_id)
    out = []
    for b in _bond_specs(record):
        out.append({
            "name": b["name"],
            "type": b.get("type"),
            "floating": bool(b.get("floating")),
            "coupon": b.get("coupon"),
            "margin": b.get("margin"),
            "priceable": b.get("type") in ("bond", "io_strip", "wacio_strip"),
        })
    return clean({"tranches": out, "scenario": record.scenario})


@router.post("/runs/{run_id}/analysis/price")
def post_price(run_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Price one tranche.

    body: {tranche, method: "yield"|"dm"|"spread"|"zero_curve",
           value: number (decimal yield / bps for dm and spread),
           nodes: [{date, rate}] (zero_curve only), as_of_month: int}
    """
    record = _record_or_410(run_id)
    result = record.result
    tranche = str(body.get("tranche") or "")
    method = str(body.get("method") or "yield")
    as_of = int(body.get("as_of_month") or 0)
    i = _tranche_index(record, tranche)

    if method == "zero_curve":
        nodes = body.get("nodes") or []
        if len(nodes) < 1:
            raise HTTPException(status_code=422, detail="zero_curve needs at least one node")
        try:
            dates = [dt.date.fromisoformat(str(n["date"])) for n in nodes]
            zeros = [float(n["rate"]) for n in nodes]
        except (KeyError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=f"Bad curve node: {exc}") from exc
        curve = DiscountCurve.from_zero_curve(dates, zeros)
        n_months = result.tranche_cashflows.shape[1]
        factors = curve.factors(n_months)
        par = float(result.original_balances[i])
        if par <= 0:
            raise HTTPException(status_code=422, detail=f"{tranche} has no par to price")
        pv = float(result.tranche_cashflows[i] @ factors)
        price = 100.0 * pv / par
        return clean({
            "tranche": tranche, "method": method, "price": price,
            "market_value": pv, "par_value": par,
            "note": "Priced off the supplied zero/swap curve; accrued and DV01 "
                    "are not defined for custom-curve pricing.",
        })

    value = body.get("value")
    if value is None:
        raise HTTPException(status_code=422, detail="value is required")
    value = float(value)
    kwargs: dict[str, float] = {}
    if method == "yield":
        kwargs["yld"] = value
    elif method == "dm":
        kwargs["dm_bps"] = value
    elif method == "spread":
        kwargs["spread_bps"] = value
    else:
        raise HTTPException(status_code=422, detail=f"Unknown method {method!r}")

    try:
        mark = mark_tranche(result, tranche, method=method if method != "yield" else "yield",
                            as_of_month=as_of, **kwargs)
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    payload = clean(mark.to_dict())
    # quick mixin cross-checks for the headline number
    if method == "yield":
        payload["mixin_price"] = clean(float(result.price_given_yield(value)[i]))
    elif method == "dm":
        payload["mixin_price"] = clean(float(result.price_given_dm(value)[i]))
    if payload.get("price") is None:
        payload["note"] = ("No price — this combination is undefined (fixed-rate "
                           "tranches have no DM; fully-paid tranches have no par).")
    return payload


@router.get("/runs/{run_id}/analysis/yield-table")
def get_yield_table(run_id: str, tranche: str = Query(...),
                    prices: str = Query("95,97.5,100,102.5,105")) -> dict[str, Any]:
    record = _record_or_410(run_id)
    _tranche_index(record, tranche)
    price_list = [float(p) for p in prices.split(",") if p.strip()]
    df = record.result.yield_table(tranche, prices=price_list)
    payload = df_records(df.reset_index())
    payload["attrs"] = clean(dict(df.attrs))
    return clean(payload)


@router.get("/runs/{run_id}/analysis/price-table")
def get_price_table(run_id: str, tranche: str = Query(...),
                    dms: str = Query("100,200,300,400,500"),
                    yields: str = Query("0.04,0.06,0.08,0.10,0.12")) -> dict[str, Any]:
    record = _record_or_410(run_id)
    _tranche_index(record, tranche)
    dm_list = [float(x) for x in dms.split(",") if x.strip()]
    yld_list = [float(x) for x in yields.split(",") if x.strip()]
    df = record.result.price_table(tranche, dms=dm_list, yields=yld_list)
    payload = df_records(df.reset_index())
    payload["attrs"] = clean(dict(df.attrs))
    payload["axis"] = df.index.name  # "dm_bps" (floating) or "yield" (fixed)
    return clean(payload)


@router.get("/runs/{run_id}/analysis/loan-pricing")
def get_loan_pricing(run_id: str, spread_bps: float = Query(0.0),
                     price: float = Query(100.0)) -> dict[str, Any]:
    """Per-repline collateral pricing across all engine groups."""
    record = _record_or_410(run_id)
    rows: list[dict[str, Any]] = []
    for model in record.models:
        ids = np.atleast_1d(model.repline.repline_id)
        wal = model.weighted_average_life()
        dur = model.mccauley_duration(spread=spread_bps)
        px = model.price_given_spread(spread=spread_bps)
        dm = model.discount_margin(price=price)
        xirr = model.xirr()
        moic = model.moic()
        for j in range(len(ids)):
            rows.append({
                "repline_id": str(ids[j]),
                "engine": type(model).__name__,
                "wal_months": float(wal[j]),
                "duration_years": float(dur[j]),
                "price_at_spread": float(px[j]),
                "dm_bps_at_price": float(dm[j]),
                "xirr": float(xirr[j]),
                "moic": float(moic[j]),
            })
    return clean({"spread_bps": spread_bps, "price": price, "rows": rows})


@router.get("/runs/{run_id}/analysis/unit-economics")
def get_unit_economics(run_id: str) -> dict[str, Any]:
    """Per-repline unit economics: the engine's repline_summary (WAL, XIRR,
    MOIC, loss/prepay rates) merged with lifetime dollar flows and per-account
    figures pulled straight off the run arrays."""
    from cashflows.analytics import repline_summary

    record = _record_or_410(run_id)
    rows: list[dict[str, Any]] = []
    for model in record.models:
        summary = repline_summary(model).to_dict(orient="records")
        accounts = np.atleast_1d(np.asarray(model.repline.accounts, dtype=float))

        def lifetime(name: str) -> np.ndarray:
            arr = getattr(model, name, None)
            if arr is None:
                return np.zeros(len(summary))
            return np.asarray(arr, dtype=float).sum(axis=1)

        interest = lifetime("revenue_interest")
        fees = lifetime("revenue_fee")
        chargeoffs = lifetime("upb_chargeoff")
        recoveries = lifetime("upb_recovery")
        servicing = lifetime("cost_servicing")
        net_cash = lifetime("unlevered_cashflows")
        for j, row in enumerate(summary):
            n_accts = float(accounts[j]) if j < len(accounts) else 1.0
            upb = float(row.get("upb") or 0)
            rows.append({
                **row,
                "engine": type(model).__name__,
                "accounts": n_accts,
                "avg_balance": upb / n_accts if n_accts > 0 else None,
                "interest_revenue": float(interest[j]),
                "fee_revenue": float(fees[j]),
                "gross_chargeoffs": float(chargeoffs[j]),
                "recoveries": float(recoveries[j]),
                "servicing_cost": float(servicing[j]),
                "net_cash": float(net_cash[j]),
                "net_cash_per_unit": float(net_cash[j]) / n_accts if n_accts > 0 else None,
                "revenue_per_unit": (float(interest[j]) + float(fees[j])) / n_accts
                                    if n_accts > 0 else None,
            })
    return clean({"rows": rows, "is_portfolio": record.is_portfolio})


@router.post("/runs/{run_id}/analysis/solve-collateral-price")
def solve_collateral_price(run_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Solve collateral pricing off the residual.

    The residual's cashflows are fixed by the run; only the equity check moves
    with the collateral purchase price:

        equity_check = collateral_cost + reserve_initial - note_proceeds

    Forward solve (target_yield given): the residual earns exactly the target
    when equity_check == PV(residual cashflows @ target), so

        collateral_price% = (PV + note_proceeds - reserve) / pool_upb * 100

    Reverse solve (collateral_price given): compute the equity check, then
    solve the residual XIRR by bisection on the monthly rate.

    body: {target_yield?: decimal, collateral_price?: pct-of-par,
           note_prices?: {name: pct}, include_reserve?: bool}
    """
    record = _record_or_410(run_id)
    result = record.result
    bonds = _bond_specs(record)
    residual_names = [b["name"] for b in bonds if b.get("type") == "residual"]
    if len(residual_names) != 1:
        raise HTTPException(status_code=422, detail="Deal needs exactly one residual tranche")
    r_idx = _tranche_index(record, residual_names[0])

    cf = np.asarray(result.tranche_cashflows[r_idx], dtype=float)
    months = np.arange(cf.shape[0])
    note_prices = body.get("note_prices") or {}
    include_reserve = bool(body.get("include_reserve", True))
    reserve = float(record.waterfall_spec.get("reserve_initial") or 0.0) if include_reserve else 0.0
    pool_upb = float(result.pool_balance_start[0])
    if pool_upb <= 0:
        raise HTTPException(status_code=422, detail="Pool has no starting balance")

    note_proceeds = 0.0
    note_detail = []
    for i, b in enumerate(bonds):
        if b.get("type") != "bond":
            continue
        face = float(result.original_balances[i])
        px = float(note_prices.get(b["name"], 100.0))
        note_proceeds += face * px / 100.0
        note_detail.append({"name": b["name"], "face": face, "price": px})

    def pv_at(y: float) -> float:
        factors = (1.0 + y / 12.0) ** (-months)
        return float(cf @ factors)

    total_cf = float(cf.sum())

    if body.get("target_yield") is not None:
        y = float(body["target_yield"])
        if y <= -0.99:
            raise HTTPException(status_code=422, detail="target_yield must be > -99%")
        pv = pv_at(y)
        collateral_cost = pv + note_proceeds - reserve
        price = 100.0 * collateral_cost / pool_upb
        return clean({
            "mode": "price_from_yield",
            "target_yield": y,
            "residual": residual_names[0],
            "residual_pv": pv,
            "equity_check": pv,
            "note_proceeds": note_proceeds,
            "notes": note_detail,
            "reserve_funded": reserve,
            "pool_upb": pool_upb,
            "collateral_cost": collateral_cost,
            "collateral_price": price,
            "residual_moic": (total_cf / pv) if pv > 0 else None,
            "warning": ("Implied price is not positive — the target yield exceeds what the "
                        "residual cashflows can support at any price.") if price <= 0 else None,
        })

    if body.get("collateral_price") is not None:
        price = float(body["collateral_price"])
        collateral_cost = price / 100.0 * pool_upb
        equity = collateral_cost + reserve - note_proceeds
        if equity <= 0:
            return clean({
                "mode": "yield_from_price", "collateral_price": price,
                "equity_check": equity, "note_proceeds": note_proceeds,
                "reserve_funded": reserve, "pool_upb": pool_upb,
                "residual_yield": None,
                "warning": "Equity check is not positive at this price — notes more than fund "
                           "the purchase; the residual yield is unbounded.",
            })
        # bisection on annual yield: pv_at is monotone decreasing in y
        lo, hi = -0.95, 10.0
        if pv_at(hi) > equity:
            yld = None  # even at 1000% the PV exceeds the outlay
        else:
            for _ in range(200):
                mid = (lo + hi) / 2.0
                if pv_at(mid) > equity:
                    lo = mid
                else:
                    hi = mid
            yld = (lo + hi) / 2.0
        return clean({
            "mode": "yield_from_price",
            "residual": residual_names[0],
            "collateral_price": price,
            "collateral_cost": collateral_cost,
            "equity_check": equity,
            "note_proceeds": note_proceeds,
            "notes": note_detail,
            "reserve_funded": reserve,
            "pool_upb": pool_upb,
            "residual_yield": yld,
            "residual_moic": total_cf / equity,
        })

    raise HTTPException(status_code=422,
                        detail="Provide target_yield or collateral_price")


@router.post("/runs/{run_id}/analysis/marks")
def post_marks(run_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Mark every tranche: {method, values: {tranche: v} | number, as_of_month}."""
    record = _record_or_410(run_id)
    method = str(body.get("method") or "spread")
    if method not in ("spread", "yield", "dm"):
        raise HTTPException(status_code=422, detail=f"Unknown method {method!r}")
    values = body.get("values")
    as_of = int(body.get("as_of_month") or 0)
    if values is None:
        raise HTTPException(status_code=422, detail="values is required")
    try:
        marks = mark_deal(record.result,
                          values if isinstance(values, (int, float)) else dict(values),
                          method=method, as_of_month=as_of)
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    rows = []
    for name, mark in marks.items():
        row = clean(mark.to_dict())
        row["tranche"] = name
        rows.append(row)
    return clean({"method": method, "as_of_month": as_of, "rows": rows})
