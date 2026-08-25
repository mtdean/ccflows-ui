"""
ccflows-ui/backend/api/portfolios.py
Portfolio CRUD + the auto-rerun analytics view: each fund's positions marked
against the freshest base run of every underlying deal.
"""

import math
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import FileResponse

import config
from core import portfolio_store, workspace
from core.document import DocumentError, slugify
from core.serialization import clean, df_records

router = APIRouter()


@router.get("/portfolios")
def get_portfolios() -> list[dict[str, Any]]:
    return portfolio_store.list_portfolios()


@router.post("/portfolios", status_code=201)
def create_portfolio(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    if set(body.keys()) <= {"name"}:
        name = body.get("name") or ""
        doc = portfolio_store.new_portfolio(name)
    else:
        doc = body
        if not doc.get("meta", {}).get("name"):
            raise DocumentError("meta.name is required", ["meta", "name"])
    slug = slugify(doc["meta"]["name"])
    if portfolio_store.exists(slug):
        raise HTTPException(status_code=409, detail=f"Portfolio '{slug}' already exists")
    return portfolio_store.save(doc)


@router.get("/portfolios/{slug}")
def get_portfolio(slug: str) -> dict[str, Any]:
    return portfolio_store.load(slug)


@router.put("/portfolios/{slug}")
def put_portfolio(slug: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    if not portfolio_store.exists(slug):
        raise HTTPException(status_code=404, detail=f"Portfolio '{slug}' not found")
    new_slug = slugify(body.get("meta", {}).get("name", slug))
    if new_slug != slug and portfolio_store.exists(new_slug):
        raise HTTPException(status_code=409, detail=f"Portfolio '{new_slug}' already exists")
    saved = portfolio_store.save(body)
    if new_slug != slug:
        portfolio_store.delete(slug)
    return saved


@router.delete("/portfolios/{slug}", status_code=204)
def delete_portfolio(slug: str) -> None:
    portfolio_store.delete(slug)


@router.get("/portfolios/{slug}/download")
def download_portfolio(slug: str) -> FileResponse:
    if not portfolio_store.exists(slug):
        raise HTTPException(status_code=404, detail=f"Portfolio '{slug}' not found")
    return FileResponse(config.WORKSPACE_DIR / f"{slug}.portfolio.json",
                        media_type="application/json",
                        filename=f"{slug}.portfolio.json")


def _mark_value(marks: dict[str, Any], deal: str, tranche: str) -> float:
    per = (marks.get("per_tranche") or {}).get(deal) or {}
    if tranche in per:
        return float(per[tranche])
    return float(marks.get("default") or 0.0)


def _resolve_mark(marks: dict[str, Any], fund_method: str, deal: str, tranche: str,
                  boundary: int) -> tuple[str, float, str]:
    """(method, value, source) — precedence: fund per-position override >
    workspace mark book (at the deal's boundary month) > fund default."""
    per = (marks.get("per_tranche") or {}).get(deal) or {}
    if tranche in per:
        return fund_method, float(per[tranche]), "override"
    from core import mark_book

    booked = mark_book.resolve(deal, tranche, boundary)
    if booked is not None:
        return booked[0], booked[1], "book"
    return fund_method, float(marks.get("default") or 0.0), "default"


def _num(value: Any) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def _solve_irr(cashflows: "np.ndarray") -> float | None:
    """Annualized IRR of a monthly cashflow vector via bisection.
    Returns None when there's no sign change to anchor a root."""
    import numpy as np

    cf = np.asarray(cashflows, dtype=float)
    if not (np.any(cf > 0) and np.any(cf < 0)):
        return None
    months = np.arange(len(cf))

    def npv(y: float) -> float:
        return float(cf @ (1.0 + y / 12.0) ** (-months))

    lo, hi = -0.95, 10.0
    if npv(lo) < 0 or npv(hi) > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2.0
        if npv(mid) > 0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def _position_cashflows(tranche_cf: "np.ndarray", share: float, cost_value: float,
                        acquired_month: int) -> "np.ndarray":
    """Position cashflow vector: -cost at acquisition, share of tranche cash after."""
    import numpy as np

    cf = np.zeros(len(tranche_cf))
    cf[acquired_month] -= cost_value
    cf[acquired_month + 1:] += share * np.asarray(tranche_cf, dtype=float)[acquired_month + 1:]
    return cf


@router.get("/portfolios/{slug}/treasury")
def get_treasury(slug: str, horizon_months: int = 24) -> dict[str, Any]:
    """The fund cash ledger: monthly, calendar-anchored, Excel-shaped."""
    from core import treasury

    doc = portfolio_store.load(slug)
    horizon = max(6, min(int(horizon_months), 120))
    return clean(treasury.build_ledger(doc, horizon_months=horizon))


@router.put("/portfolios/{slug}/treasury")
def put_treasury(slug: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Update the fund's treasury settings (opening cash, credit line, events)."""
    from core.treasury import EVENT_TYPES

    doc = portfolio_store.load(slug)
    events = []
    for i, e in enumerate(body.get("events") or []):
        if e.get("type") not in EVENT_TYPES:
            raise HTTPException(status_code=422, detail=f"events[{i}]: bad type")
        try:
            float(e.get("amount"))
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail=f"events[{i}]: bad amount") from None
        if not str(e.get("month") or "")[:7]:
            raise HTTPException(status_code=422, detail=f"events[{i}]: month required")
        events.append({"month": str(e["month"])[:7], "type": e["type"],
                       "amount": float(e["amount"]), "note": str(e.get("note") or "")})
    doc["treasury"] = {
        "opening_cash": float(body.get("opening_cash") or 0.0),
        "credit_line": {"limit": float((body.get("credit_line") or {}).get("limit") or 0.0),
                        "rate": float((body.get("credit_line") or {}).get("rate") or 0.0)},
        "events": sorted(events, key=lambda e: e["month"]),
    }
    portfolio_store.save(doc)
    return {"ok": True}


@router.get("/portfolios/{slug}/pnl")
def get_fund_pnl(slug: str, freq: str = "Q") -> dict[str, Any]:
    """Fund P&L: engine per-position fair-value statements (cost basis, face,
    acquisition month, book-schedule marks) aggregated onto the calendar."""
    import pandas as pd

    from cashflows import MarkSchedule, TranchePosition  # noqa: F401 — TranchePosition doc parity

    from core import mark_book, tracking

    if freq not in ("M", "Q", "A"):
        raise HTTPException(status_code=422, detail="freq must be M, Q, or A")
    doc = portfolio_store.load(slug)
    marks_cfg = doc.get("marks") or {}
    fund_method = str(marks_cfg.get("method") or "spread")

    frames: list[pd.DataFrame] = []
    skipped: list[dict[str, str]] = []
    for p in doc.get("positions") or []:
        deal_slug, tranche = p["deal"], p["tranche"]
        try:
            deal_doc = workspace.load(deal_slug)
            if not tracking.has_actuals(deal_doc):
                skipped.append({"position": f"{deal_slug}/{tranche}",
                                "reason": "no actuals — P&L is realized-anchored"})
                continue
            tracked = tracking.get_tracked(deal_slug, deal_doc)
            boundary = int(tracked.spliced().boundary_month)
            schedule = mark_book.engine_schedule(deal_slug, tranche)
            if schedule is None:
                method, value, _ = _resolve_mark(marks_cfg, fund_method,
                                                 deal_slug, tranche, boundary)
                schedule = MarkSchedule({0: value}, method=method)
            stmt = tracked.pnl(
                tranche=tranche,
                cost_basis=float(p.get("cost_basis", 100.0)),
                face=float(p.get("face", 0.0)),
                acquired_month=int(p.get("acquired_month") or 0),
                spreads_or_yield=schedule,
            )
            monthly = stmt.monthly()
            monthly = monthly.assign(
                period=pd.PeriodIndex(pd.to_datetime(monthly["date"]), freq="M").astype(str))
            frames.append(monthly[["period", "is_actual", "beginning_mv", "additions",
                                   "interest_income", "realized_pl", "unrealized_pl",
                                   "cash_received", "ending_mv"]])
        except Exception as exc:  # noqa: BLE001 — one bad position shouldn't kill the view
            skipped.append({"position": f"{deal_slug}/{tranche}", "reason": str(exc)})

    if not frames:
        return clean({"rows": [], "skipped": skipped, "freq": freq})

    combined = pd.concat(frames, ignore_index=True)
    # sum across positions per calendar month first...
    by_month = combined.groupby("period", as_index=False).agg(
        is_actual=("is_actual", "all"),
        beginning_mv=("beginning_mv", "sum"),
        additions=("additions", "sum"),
        interest_income=("interest_income", "sum"),
        realized_pl=("realized_pl", "sum"),
        unrealized_pl=("unrealized_pl", "sum"),
        cash_received=("cash_received", "sum"),
        ending_mv=("ending_mv", "sum"),
    ).sort_values("period")
    # ...then bucket to the requested frequency (begin = first month, end = last)
    by_month["bucket"] = (pd.PeriodIndex(by_month["period"], freq="M")
                          .asfreq(freq).astype(str))
    grouped = by_month.groupby("bucket", as_index=False).agg(
        is_actual=("is_actual", "all"),
        beginning_mv=("beginning_mv", "first"),
        additions=("additions", "sum"),
        interest_income=("interest_income", "sum"),
        realized_pl=("realized_pl", "sum"),
        unrealized_pl=("unrealized_pl", "sum"),
        cash_received=("cash_received", "sum"),
        ending_mv=("ending_mv", "last"),
    ).rename(columns={"bucket": "period"})
    grouped["total_pl"] = (grouped["interest_income"] + grouped["realized_pl"]
                           + grouped["unrealized_pl"])
    return clean({"rows": df_records(grouped)["records"],
                  "columns": [str(c) for c in grouped.columns],
                  "skipped": skipped, "freq": freq})


@router.get("/portfolios/{slug}/analytics")
def get_analytics(slug: str) -> dict[str, Any]:
    """Mark every position against the freshest state of its deal. Deals with
    actuals are marked at the splice boundary (monitoring-aware); the rest at
    month 0 of the base projection. Adds IRR-to-live (hold to maturity) and
    fair-market IRR (terminate today at the fund's mark)."""
    import numpy as np

    from cashflows import TranchePosition, mark_position

    from core import tracking

    doc = portfolio_store.load(slug)
    marks_cfg = doc.get("marks") or {}
    method = str(marks_cfg.get("method") or "spread")
    kwarg_name = {"spread": "spread_bps", "yield": "yld", "dm": "dm_bps"}.get(method)
    if kwarg_name is None:
        raise HTTPException(status_code=422, detail=f"Unknown mark method {method!r}")

    # one context per deal: (mode, names, original_balances, combined_cf, boundary, marker)
    contexts: dict[str, dict[str, Any]] = {}
    deal_errors: dict[str, str] = {}
    freshness: dict[str, Any] = {}
    for p in doc.get("positions") or []:
        deal_slug = p["deal"]
        if deal_slug in contexts or deal_slug in deal_errors:
            continue
        try:
            deal_doc = workspace.load(deal_slug)
        except FileNotFoundError:
            deal_errors[deal_slug] = "deal not found in workspace"
            continue
        try:
            if tracking.has_actuals(deal_doc):
                from core.treasury import apply_call_overlay

                tracked = tracking.get_tracked(deal_slug, deal_doc)
                spliced = tracked.spliced()
                contexts[deal_slug] = {
                    "mode": "spliced",
                    "names": list(spliced.tranche_names),
                    "originals": np.asarray(tracked.deal.original_balances, dtype=float),
                    "combined_cf": apply_call_overlay(
                        np.asarray(spliced.tranche_cashflows_combined, dtype=float),
                        np.asarray(spliced.tranche_balance_end_combined, dtype=float),
                        deal_doc),
                    "boundary": int(spliced.boundary_month),
                    "spliced": spliced,
                }
                freshness[deal_slug] = {"reran": True, "run_at": None,
                                        "scenario": "base+actuals",
                                        "boundary_month": int(spliced.boundary_month)}
            else:
                run, reran, at = portfolio_store.cached_base_run(deal_slug, deal_doc)
                contexts[deal_slug] = {
                    "mode": "projection",
                    "names": [b["name"] for b in (deal_doc.get("waterfall") or {}).get("bonds", [])],
                    "originals": np.asarray(run.result.original_balances, dtype=float),
                    "combined_cf": np.asarray(run.result.tranche_cashflows, dtype=float),
                    "boundary": 0,
                    "result": run.result,
                }
                freshness[deal_slug] = {"reran": reran, "run_at": at, "scenario": "base"}
        except Exception as exc:  # noqa: BLE001 — a broken deal shouldn't kill the view
            deal_errors[deal_slug] = f"run failed: {exc}"

    rows: list[dict[str, Any]] = []
    live_vectors: list[Any] = []
    fm_vectors: list[Any] = []
    for i, p in enumerate(doc.get("positions") or []):
        deal_slug = p["deal"]
        tranche = p["tranche"]
        base = {
            "index": i, "deal": deal_slug, "tranche": tranche,
            "face": float(p.get("face", 0)), "cost_basis": float(p.get("cost_basis", 0)),
        }
        if deal_slug in deal_errors:
            rows.append({**base, "error": deal_errors[deal_slug]})
            continue
        ctx = contexts[deal_slug]
        pos_method, value, mark_source = _resolve_mark(
            marks_cfg, method, deal_slug, tranche, ctx["boundary"])
        pos_kwarg = {"spread": "spread_bps", "yield": "yld", "dm": "dm_bps"}[pos_method]
        acquired = int(p.get("acquired_month") or 0)
        try:
            position = TranchePosition(
                tranche_name=tranche,
                face=float(p.get("face", 0)),
                cost_basis=float(p.get("cost_basis", 100.0)),
                acquired_month=acquired,
                deal_id=deal_slug,
            )
            if ctx["mode"] == "spliced":
                frame = ctx["spliced"].position_marks([position], method=pos_method,
                                                     **{pos_kwarg: value})
                m = frame.iloc[0].to_dict()
                m = {"factor": m.get("factor"), "par_value": m.get("par"),
                     "price": m.get("price"), "market_value": m.get("market_value"),
                     "accrued_interest": m.get("accrued"), "cost_value": m.get("cost"),
                     "unrealized_pnl": m.get("pnl"), "wal_remaining": m.get("wal"),
                     "modified_duration": m.get("duration"), "spread_dv01": m.get("dv01")}
            else:
                m = mark_position(position, ctx["result"], method=pos_method,
                                  **{pos_kwarg: value}).to_dict()
        except (ValueError, KeyError, TypeError) as exc:
            rows.append({**base, "error": str(exc)})
            continue

        # IRRs
        irr_to_live = None
        fm_irr = None
        try:
            idx = ctx["names"].index(tranche)
            original = float(ctx["originals"][idx])
            share = base["face"] / original if original > 0 else 0.0
            cost_value = base["cost_basis"] / 100.0 * base["face"]
            combined = ctx["combined_cf"][idx]
            live_cf = _position_cashflows(combined, share, cost_value, acquired)
            irr_to_live = _solve_irr(live_cf)
            live_vectors.append(live_cf)
            boundary = ctx["boundary"]
            if boundary > acquired:
                mv = _num(m.get("market_value")) or 0.0
                accrued = _num(m.get("accrued_interest")) or 0.0
                fm_cf = np.zeros(boundary + 1)
                fm_cf[acquired] -= cost_value
                fm_cf[acquired + 1:] += share * combined[acquired + 1: boundary + 1]
                fm_cf[boundary] += mv + accrued
                fm_irr = _solve_irr(fm_cf)
                fm_vectors.append(fm_cf)
        except (ValueError, IndexError):
            pass

        rows.append({
            **base,
            "mark_value": value,
            "mark_method": pos_method,
            "mark_source": mark_source,
            "factor": _num(m.get("factor")),
            "par_value": _num(m.get("par_value")),
            "price": _num(m.get("price")),
            "market_value": _num(m.get("market_value")),
            "accrued": _num(m.get("accrued_interest")),
            "cost_value": _num(m.get("cost_value")),
            "pnl": _num(m.get("unrealized_pnl")),
            "wal": _num(m.get("wal_remaining")),
            "duration": _num(m.get("modified_duration")),
            "dv01": _num(m.get("spread_dv01")),
            "irr_to_live": irr_to_live,
            "fm_irr": fm_irr,
        })

    ok_rows = [r for r in rows if "error" not in r]
    total_mv = sum(r["market_value"] or 0 for r in ok_rows)

    def wavg(key: str) -> float | None:
        pairs = [(r[key], r["market_value"] or 0) for r in ok_rows if r.get(key) is not None]
        weight = sum(w for _, w in pairs)
        return sum(v * w for v, w in pairs) / weight if weight else None

    totals = {
        "face": sum(r["face"] for r in ok_rows),
        "par_value": sum(r["par_value"] or 0 for r in ok_rows),
        "market_value": total_mv,
        "accrued": sum(r["accrued"] or 0 for r in ok_rows),
        "cost_value": sum(r["cost_value"] or 0 for r in ok_rows),
        "pnl": sum(r["pnl"] or 0 for r in ok_rows),
        "wal": wavg("wal"),
        "duration": wavg("duration"),
    }

    # portfolio-level IRRs on the summed cashflow vectors (not averaged)
    if live_vectors:
        max_len = max(len(v) for v in live_vectors)
        summed = np.zeros(max_len)
        for v in live_vectors:
            summed[: len(v)] += v
        totals["irr_to_live"] = _solve_irr(summed)
    else:
        totals["irr_to_live"] = None
    if fm_vectors:
        max_len = max(len(v) for v in fm_vectors)
        summed = np.zeros(max_len)
        for v in fm_vectors:
            summed[: len(v)] += v
        totals["fm_irr"] = _solve_irr(summed)
    else:
        totals["fm_irr"] = None

    for deal_slug, msg in deal_errors.items():
        freshness[deal_slug] = {"error": msg}

    return clean({
        "portfolio": doc["meta"],
        "method": method,
        "rows": rows,
        "totals": totals,
        "deals": freshness,
    })
