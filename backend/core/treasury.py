"""
ccflows-ui/backend/core/treasury.py
Fund-level treasury: a monthly, calendar-anchored cash ledger per portfolio.

Each deal's month m maps to a calendar period via its run_date, so receipts
from deals with different closings land in the right rows of one fund ledger:

  opening cash
  + contributions            - distributions          (capital events)
  + credit draws             - repayments - interest  (credit line)
  - position purchases       + deal receipts          (the book)
  = closing cash;  dry powder = cash + undrawn credit capacity
"""

from typing import Any

import numpy as np
import pandas as pd

from . import portfolio_store, tracking, workspace

EVENT_TYPES = ("contribution", "distribution", "draw", "repay")


def default_treasury() -> dict[str, Any]:
    return {"opening_cash": 0.0, "credit_line": {"limit": 0.0, "rate": 0.0},
            "events": []}


def _period(run_date: str, month: int) -> pd.Period:
    return pd.Period(run_date[:7], freq="M") + month


def apply_call_overlay(cashflows: np.ndarray, balances: np.ndarray,
                       doc: dict[str, Any]) -> np.ndarray:
    """A pending call on a deal WITH actuals: the engine's call transform can't
    combine with a tape, so overlay the takeout by hand — cashflows stop at the
    call month and each tranche receives its balance at the call price there."""
    call = doc.get("call") or {}
    if not call.get("enabled") or call.get("call_month") is None:
        return cashflows
    k = int(call["call_month"])
    if k >= cashflows.shape[1] - 1:
        return cashflows
    price = float(call.get("call_price_pct") or 100.0) / 100.0
    out = np.nan_to_num(cashflows).copy()
    out[:, k] += np.nan_to_num(balances[:, k]) * price
    out[:, k + 1:] = 0.0
    return out


def _deal_context(deal_slug: str) -> dict[str, Any] | None:
    """Combined per-tranche cashflows + calendar anchor for one deal."""
    try:
        doc = workspace.load(deal_slug)
    except FileNotFoundError:
        return None
    run_date = str((doc.get("run") or {}).get("run_date") or "2026-01-01")
    try:
        if tracking.has_actuals(doc):
            tracked = tracking.get_tracked(deal_slug, doc)
            spliced = tracked.spliced()
            cashflows = apply_call_overlay(
                np.asarray(spliced.tranche_cashflows_combined, dtype=float),
                np.asarray(spliced.tranche_balance_end_combined, dtype=float),
                doc)
            return {
                "names": list(spliced.tranche_names),
                "originals": np.asarray(tracked.deal.original_balances, dtype=float),
                "cashflows": cashflows,
                "boundary": int(spliced.boundary_month),
                "run_date": run_date,
            }
        run, _, _ = portfolio_store.cached_base_run(deal_slug, doc)
        # (calls on tape-less deals are already applied inside the engine run)
        return {
            "names": [b["name"] for b in (doc.get("waterfall") or {}).get("bonds", [])],
            "originals": np.asarray(run.result.original_balances, dtype=float),
            "cashflows": np.asarray(run.result.tranche_cashflows, dtype=float),
            "boundary": 0,
            "run_date": run_date,
        }
    except Exception as exc:  # noqa: BLE001 — broken deal -> ledger note, not a 500
        return {"error": str(exc), "run_date": run_date}


def build_ledger(doc: dict[str, Any], horizon_months: int = 24) -> dict[str, Any]:
    treasury = {**default_treasury(), **(doc.get("treasury") or {})}
    credit = {**{"limit": 0.0, "rate": 0.0}, **(treasury.get("credit_line") or {})}
    events = [e for e in (treasury.get("events") or [])
              if e.get("type") in EVENT_TYPES and e.get("month")]

    contexts: dict[str, dict[str, Any]] = {}
    deal_errors: dict[str, str] = {}
    for p in doc.get("positions") or []:
        slug = p["deal"]
        if slug in contexts or slug in deal_errors:
            continue
        ctx = _deal_context(slug)
        if ctx is None:
            deal_errors[slug] = "deal not found"
        elif "error" in ctx:
            deal_errors[slug] = ctx["error"]
        else:
            contexts[slug] = ctx

    # per-period flow buckets, keyed by pd.Period
    purchases: dict[pd.Period, float] = {}
    receipts: dict[pd.Period, dict[str, float]] = {}
    boundaries: list[pd.Period] = []
    periods: set[pd.Period] = set()

    for e in events:
        periods.add(pd.Period(str(e["month"])[:7], freq="M"))

    for p in doc.get("positions") or []:
        slug = p["deal"]
        ctx = contexts.get(slug)
        if ctx is None:
            continue
        tranche = p["tranche"]
        if tranche not in ctx["names"]:
            deal_errors.setdefault(slug, f"no tranche {tranche!r}")
            continue
        idx = ctx["names"].index(tranche)
        original = float(ctx["originals"][idx])
        share = float(p.get("face", 0)) / original if original > 0 else 0.0
        acquired = int(p.get("acquired_month") or 0)
        cost = float(p.get("cost_basis", 100.0)) / 100.0 * float(p.get("face", 0))
        buy_period = _period(ctx["run_date"], acquired)
        purchases[buy_period] = purchases.get(buy_period, 0.0) + cost
        periods.add(buy_period)
        cf = ctx["cashflows"][idx]
        for m in range(acquired + 1, len(cf)):
            amount = share * float(np.nan_to_num(cf[m]))
            if amount == 0.0:
                continue
            per = _period(ctx["run_date"], m)
            receipts.setdefault(per, {})
            receipts[per][slug] = receipts[per].get(slug, 0.0) + amount
            periods.add(per)

    for ctx in contexts.values():
        if ctx["boundary"] > 0:
            boundaries.append(_period(ctx["run_date"], ctx["boundary"]))
    actual_through = max(boundaries) if boundaries else None

    if not periods:
        return {"rows": [], "snapshot": None, "deal_errors": deal_errors,
                "treasury": treasury}

    start = min(periods)
    end = (actual_through or start) + horizon_months
    end = max(end, start + horizon_months)

    events_by_period: dict[pd.Period, list[dict[str, Any]]] = {}
    for e in events:
        events_by_period.setdefault(
            pd.Period(str(e["month"])[:7], freq="M"), []).append(e)

    # Committed-but-unfunded: revolver-style positions where the fund's
    # commitment exceeds the funded face. Dry powder reads both ways —
    # gross, and net of what could be called.
    commitments_by_position: list[dict[str, Any]] = []
    unfunded_commitments = 0.0
    for p in doc.get("positions") or []:
        commitment = float(p.get("commitment") or 0.0)
        if commitment <= 0:
            continue
        funded = float(p.get("face") or 0.0)
        unfunded = max(0.0, commitment - funded)
        unfunded_commitments += unfunded
        commitments_by_position.append({
            "deal": p.get("deal"), "tranche": p.get("tranche"),
            "commitment": commitment, "funded": funded, "unfunded": unfunded,
        })

    rows: list[dict[str, Any]] = []
    cash = float(treasury.get("opening_cash") or 0.0)
    drawn = 0.0
    limit = float(credit.get("limit") or 0.0)
    rate = float(credit.get("rate") or 0.0)
    per = start
    while per <= end:
        # interest accrues on the balance carried INTO the month — a draw this
        # month starts paying interest next month
        interest = drawn * rate / 12.0
        contributions = distributions = draws = repays = 0.0
        notes: list[str] = []
        for e in events_by_period.get(per, []):
            amount = float(e.get("amount") or 0.0)
            kind = e["type"]
            if kind == "contribution":
                contributions += amount
            elif kind == "distribution":
                distributions += amount
            elif kind == "draw":
                if drawn + amount > limit:
                    notes.append(f"draw clipped to limit ({limit:,.0f})")
                    amount = max(0.0, limit - drawn)
                draws += amount
                drawn += amount
            elif kind == "repay":
                if amount > drawn:
                    notes.append("repay clipped to drawn balance")
                    amount = drawn
                repays += amount
                drawn -= amount
        deal_in = receipts.get(per, {})
        total_in = sum(deal_in.values())
        bought = purchases.get(per, 0.0)

        opening = cash
        net = (contributions - distributions + draws - repays
               - interest - bought + total_in)
        cash = opening + net
        if cash < 0:
            notes.append("cash negative — fund needs a draw or contribution")
        rows.append({
            "period": str(per),
            "is_actual": actual_through is not None and per <= actual_through,
            "opening_cash": opening,
            "contributions": contributions,
            "distributions": distributions,
            "credit_draws": draws,
            "credit_repayments": repays,
            "credit_interest": interest,
            "purchases": bought,
            "deal_receipts": total_in,
            "receipts_by_deal": deal_in,
            "net_cash_flow": net,
            "closing_cash": cash,
            "credit_drawn": drawn,
            "credit_available": max(0.0, limit - drawn),
            "dry_powder": cash + max(0.0, limit - drawn),
            "dry_powder_net": cash + max(0.0, limit - drawn) - unfunded_commitments,
            "notes": "; ".join(notes),
        })
        per += 1

    as_of = actual_through or start
    snap_row = next((r for r in rows if r["period"] == str(as_of)), rows[-1])
    snapshot = {
        "as_of": snap_row["period"],
        "cash": snap_row["closing_cash"],
        "credit_drawn": snap_row["credit_drawn"],
        "credit_available": snap_row["credit_available"],
        "dry_powder": snap_row["dry_powder"],
        "dry_powder_net": snap_row["dry_powder_net"],
        "unfunded_commitments": unfunded_commitments,
        "commitments_by_position": commitments_by_position,
        "cumulative_receipts": sum(r["deal_receipts"] for r in rows
                                   if r["period"] <= snap_row["period"]),
        "cumulative_purchases": sum(r["purchases"] for r in rows
                                    if r["period"] <= snap_row["period"]),
    }
    return {"rows": rows, "snapshot": snapshot, "deal_errors": deal_errors,
            "treasury": treasury}
