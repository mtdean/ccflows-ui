"""
ccflows-ui/backend/core/takeout.py
Securitization takeout: season a deal's collateral to month k and spin up a
term deal from it — the "balance sheet / warehouse it, then securitize a month
later" lifecycle.

The seasoning follows the engine's own splice conventions (its curve
classification lists are imported directly): month-on-book curves shift left
by k, face-anchored timing curves shift AND rescale to the surviving balance,
cumulative frameworks re-anchor to zero at the boundary. Balances come from
actuals when a tape covers month k, otherwise from the projection.
"""

import dataclasses
from typing import Any

import numpy as np
import pandas as pd

from cashflows.actuals.splice import (
    _CUMULATIVE_CURVES,
    _FACE_ANCHORED_CURVES,
    _SHIFT_CURVES,
)
from cashflows.serialize.recipe import repline_to_dict

from . import engine_bridge, tracking


def _shift(curve: np.ndarray, k: int) -> np.ndarray:
    out = np.empty_like(curve)
    out[: len(curve) - k] = curve[k:]
    out[len(curve) - k:] = curve[-1]
    return out


def season_replines(doc: dict[str, Any], k: int) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Season every repline to month k. Returns (repline entries, info)."""
    if ((doc.get("run") or {}).get("originations") or {}).get("schedule"):
        raise ValueError("Takeouts of forward-flow build-up pools aren't supported yet "
                         "— the vintage stack has no per-repline seasoned state")
    replines, _ = engine_bridge.build_replines(doc)
    run_date = str((doc.get("run") or {}).get("run_date") or "2026-01-01")
    _, models, _ = engine_bridge.run_collateral(replines, doc.get("rates"), run_date)
    if len(models) > 1:
        raise ValueError("Takeouts need a single collateral engine type")
    model = models[0]

    # balances at k: actuals when the tape covers month k, else the projection
    source = "projection"
    balance_arrays = model
    if tracking.has_actuals(doc):
        tracked = tracking.get_tracked(doc["meta"]["slug"] if doc.get("meta") else "takeout", doc)
        spliced = tracked.spliced()
        if int(spliced.boundary_month) >= k:
            balance_arrays = spliced.collateral
            source = "actuals"

    n_months = model.upb_end.shape[1]
    if not (1 <= k <= n_months - 13):
        raise ValueError(f"month must be between 1 and {n_months - 13}")

    ids = [str(x) for x in np.atleast_1d(model.repline.repline_id)]
    entries: list[dict[str, Any]] = []
    total_balance = 0.0
    for j, repline in enumerate(replines):
        upb_k = float(np.nan_to_num(balance_arrays.upb_end[j, k]))
        if upb_k <= 1.0:
            continue
        original_face = float(repline.upb)
        changes: dict[str, Any] = {
            "upb": upb_k,
            "age": int(repline.age) + k,
        }
        accts = getattr(balance_arrays, "accts_end", None)
        if accts is not None and float(np.nan_to_num(accts[j, k])) > 0:
            changes["accounts"] = float(accts[j, k])
        for name in _SHIFT_CURVES:
            curve = getattr(repline, name, None)
            if curve is None or np.ndim(curve) == 0:
                continue
            changes[name] = _shift(np.asarray(curve, dtype=float), k)
        for name in _FACE_ANCHORED_CURVES:
            curve = getattr(repline, name, None)
            if curve is None or not np.any(curve):
                continue
            shifted = _shift(np.asarray(curve, dtype=float), k)
            changes[name] = shifted * (original_face / upb_k)
        for name in _CUMULATIVE_CURVES:
            curve = getattr(repline, name, None)
            if curve is None or not np.any(curve):
                continue
            arr = np.asarray(curve, dtype=float)
            anchored = np.clip(_shift(arr, k) - arr[min(k, len(arr) - 1)], 0.0, None)
            changes[name] = anchored
        seasoned = dataclasses.replace(repline, **changes)
        entries.append({"inline": repline_to_dict(seasoned)})
        total_balance += upb_k

    if not entries:
        raise ValueError(f"No collateral survives to month {k}")
    return entries, {"balance": total_balance, "source": source,
                     "run_date": run_date, "repline_ids": ids}


STRUCTURES: dict[str, list[tuple[str, float, float]]] = {
    "abr": [("A", 0.85, 0.055), ("B", 0.10, 0.075)],
    "abcr": [("A", 0.80, 0.055), ("B", 0.10, 0.07), ("C", 0.05, 0.09)],
    "abcder": [("A", 0.70, 0.05), ("B", 0.10, 0.06), ("C", 0.08, 0.07),
               ("D", 0.05, 0.085), ("E", 0.04, 0.10)],
}


def term_waterfall(structure: str, warehouse_doc: dict[str, Any]) -> dict[str, Any]:
    if structure == "copy":
        import copy

        return copy.deepcopy(warehouse_doc.get("waterfall") or {})
    sizes = STRUCTURES.get(structure)
    if sizes is None:
        raise ValueError(f"Unknown structure {structure!r} "
                         f"(known: {', '.join(STRUCTURES)}, copy)")
    bonds: list[dict[str, Any]] = [
        {"type": "bond", "name": n, "size_pct": s, "balance": None, "coupon": c,
         "margin": None, "floating": False, "pik": False,
         "rate_cap": None, "rate_floor": None}
        for n, s, c in sizes
    ] + [{"type": "residual", "name": "R", "balance": None}]
    steps: list[dict[str, Any]] = [
        {"name": "servicing", "type": "fee", "annual_rate": 0.01, "basis": "pool",
         "cap": None, "fixed_annual": None},
    ]
    for i, (n, _, _) in enumerate(sizes):
        steps.append({"name": f"{n}_interest", "type": "pay_interest", "bonds": [n],
                      "reserve_draw": i == 0, "sources": None})
    steps += [
        {"name": "reserve", "type": "reserve_deposit", "target_pct": 0.01, "target": None},
        {"name": "principal", "type": "pay_principal", "bonds": [], "rule": "sequential",
         "amount": "collections", "sources": None},
        {"name": "residual", "type": "pay_residual"},
    ]
    return {"schema": "cashflows.waterfall/1", "reserve_initial": 0.0,
            "bonds": bonds, "triggers": [], "steps": steps}


def takeout_run_date(run_date: str, k: int) -> str:
    period = pd.Period(run_date[:7], freq="M") + k
    return f"{period.year:04d}-{period.month:02d}-01"
