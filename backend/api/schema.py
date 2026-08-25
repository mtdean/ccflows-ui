"""
ccflows-ui/backend/api/schema.py
Registry introspection: the frontend generates repline forms, the "+ add knob"
menu, step palettes, and scenario chips from these endpoints — the engine's
own registries are the single source of truth, nothing is duplicated by hand
except the step parameter schemas (spec.py's encoder table has no param docs).
"""

import dataclasses
import typing
from typing import Any

from fastapi import APIRouter, Body

from cashflows.dataclasses.curves import STRESS_SCENARIOS, CurveStressMultipliers
from cashflows.dataclasses.field_registry import (
    REPLINE_FIELDS,
    REQUIRED,
    curve_field_names,
    dollar_curve_names,
    library_curve_names,
    probability_curve_names,
    ratio_curve_names,
    repline_owned_curve_names,
    scalar_field_names,
    seasonality_curve_names,
    serializable_scalar_names,
)
from cashflows.dataclasses.repline import ReplineInputs
from cashflows.liabilities.triggers import _BUILTIN_METRICS
from cashflows.quick import parse_pct, parse_rate
from cashflows.registry import list_collateral_types
from cashflows.scenarios.library import MACRO_SCENARIOS

from core.serialization import clean

router = APIRouter()

# Fields always shown on a ReplineCard; everything else arrives via the knob menu.
CORE_FIELDS = ("repline_id", "amortization_type", "upb", "gross_wac", "net_wac",
               "term", "age", "cdr", "cpr")

_LITERAL_CHOICES: dict[str, tuple[str, ...]] = {
    name: typing.get_args(hint)
    for name, hint in typing.get_type_hints(ReplineInputs).items()
    if typing.get_origin(hint) is typing.Literal
}


@router.get("/schema/repline-fields")
def repline_fields() -> dict[str, Any]:
    fields = []
    for f in REPLINE_FIELDS:
        if f.kind == "derived_str":
            continue  # derived by __post_init__; never edited or serialized
        default = None if f.default is REQUIRED else f.default
        fields.append({
            "name": f.name,
            "kind": f.kind,
            "default": default,
            "required": f.default is REQUIRED,
            "base_curve": f.base_curve,
            "threshold": None if f.threshold in (None, float("inf")) else f.threshold,
            "doc": f.doc,
            "processing": f.processing,
            "choices": list(_LITERAL_CHOICES.get(f.name, ())) or None,
            "core": f.name in CORE_FIELDS,
        })
    return clean({
        "fields": fields,
        "core": list(CORE_FIELDS),
        "groups": {
            "scalars": list(scalar_field_names()),
            "serializable_scalars": list(serializable_scalar_names()),
            "curves": list(curve_field_names()),
            "probability_curves": list(probability_curve_names()),
            "ratio_curves": list(ratio_curve_names()),
            "dollar_curves": list(dollar_curve_names()),
            "seasonality_curves": list(seasonality_curve_names()),
            "library_curves": list(library_curve_names()),
            "repline_owned_curves": list(repline_owned_curve_names()),
        },
    })


@router.get("/schema/collateral-types")
def collateral_types() -> dict[str, Any]:
    by_class: dict[str, dict[str, Any]] = {}
    for alias, cls in list_collateral_types().items():
        entry = by_class.setdefault(cls.__name__, {
            "class": cls.__name__, "aliases": [],
            "doc": (cls.__doc__ or "").strip().split("\n")[0],
        })
        entry["aliases"].append(alias)
    return {"types": list(by_class.values())}


# Parameter schemas for each waterfall step type. Keys match the spec.py type
# names ("fee", "pay_interest", ...) so drafts serialize straight into the
# engine's cashflows.waterfall/1 document. Param kinds understood by the UI:
# float | int | bool | enum | bonds (multi-select of bond names) |
# bond (single) | trigger (trigger name ref) | step_name | steps (nested) |
# schedule (list of floats) | str
STEP_SCHEMAS: list[dict[str, Any]] = [
    {"type": "fee", "label": "Fee", "group": "PAYMENTS",
     "doc": "Senior fee accrued on pool or note balance; unpaid amounts carry forward.",
     "params": [
         {"name": "annual_rate", "kind": "float", "default": 0.01, "doc": "Annual rate (decimal)"},
         {"name": "basis", "kind": "enum", "choices": ["pool", "notes"], "default": "pool"},
         {"name": "cap", "kind": "float", "default": None, "optional": True, "doc": "Annual dollar cap"},
         {"name": "fixed_annual", "kind": "float", "default": None, "optional": True, "doc": "Fixed annual dollars"},
     ]},
    {"type": "pay_interest", "label": "Pay Interest", "group": "PAYMENTS",
     "doc": "Pay current interest (plus shortfalls) to the named bonds in order.",
     "params": [
         {"name": "bonds", "kind": "bonds", "default": []},
         {"name": "reserve_draw", "kind": "bool", "default": False, "doc": "May draw the reserve on shortfall"},
     ]},
    {"type": "pay_principal", "label": "Pay Principal", "group": "PAYMENTS",
     "doc": "Distribute principal collections (or all cash) to bonds.",
     "params": [
         {"name": "bonds", "kind": "bonds", "default": [], "doc": "Empty = all funded bonds"},
         {"name": "rule", "kind": "enum", "choices": ["sequential", "pro_rata"], "default": "sequential"},
         {"name": "amount", "kind": "enum", "choices": ["collections", "all"], "default": "collections"},
     ]},
    {"type": "turbo", "label": "Turbo", "group": "PAYMENTS",
     "doc": "Accelerate principal with all remaining cash.",
     "params": [
         {"name": "bonds", "kind": "bonds", "default": [], "doc": "Empty = all funded bonds"},
         {"name": "fraction", "kind": "float", "default": 1.0, "doc": "Share of remaining cash, (0,1]"},
         {"name": "tail_to_residual", "kind": "bool", "default": True},
     ]},
    {"type": "priority_principal", "label": "Priority Principal", "group": "PAYMENTS",
     "doc": "Parity-repair principal through the named bond (FPPDA/SPPDA).",
     "params": [{"name": "through", "kind": "bond", "default": None}]},
    {"type": "pay_residual", "label": "Pay Residual", "group": "PAYMENTS",
     "doc": "Sweep whatever remains to the residual. Must be the last step.",
     "params": []},
    {"type": "target_oc", "label": "Target OC", "group": "CREDIT SUPPORT",
     "doc": "Pay principal until overcollateralization reaches the target.",
     "params": [
         {"name": "target_pct", "kind": "float", "default": 0.05},
         {"name": "floor_pct", "kind": "float", "default": 0.0},
     ]},
    {"type": "reserve_deposit", "label": "Reserve Deposit", "group": "CREDIT SUPPORT",
     "doc": "Top the reserve account up to a target (pct of pool or dollars).",
     "params": [
         {"name": "target_pct", "kind": "float", "default": 0.01, "optional": True},
         {"name": "target", "kind": "float", "default": None, "optional": True, "doc": "Dollar target"},
     ]},
    {"type": "trap_deposit", "label": "Trap Deposit", "group": "CREDIT SUPPORT",
     "doc": "Trap cash while a trigger is breached; release on cure.",
     "params": [
         {"name": "trigger", "kind": "trigger", "default": None},
         {"name": "pct", "kind": "float", "default": 1.0},
     ]},
    {"type": "coverage_diversion", "label": "Coverage Diversion (OC/IC)", "group": "CREDIT SUPPORT",
     "doc": "CLO per-class OC/IC test with solve-for-cure diversion.",
     "params": [
         {"name": "through", "kind": "bond", "default": None},
         {"name": "oc_trigger", "kind": "float", "default": None, "optional": True},
         {"name": "ic_trigger", "kind": "float", "default": None, "optional": True},
     ]},
    {"type": "liquidate", "label": "Liquidate", "group": "CONTROL FLOW",
     "doc": "One-shot forced sale of the pool at a severity haircut.",
     "params": [{"name": "severity", "kind": "float", "default": 0.0}]},
    {"type": "if", "label": "If (trigger branch)", "group": "CONTROL FLOW",
     "doc": "Run THEN steps while the trigger is breached, else the OTHERWISE steps.",
     "params": [
         {"name": "trigger", "kind": "trigger", "default": None},
         {"name": "then", "kind": "steps", "default": []},
         {"name": "otherwise", "kind": "steps", "default": []},
     ]},
    {"type": "swap", "label": "Interest Rate Swap", "group": "HEDGES",
     "doc": "Pay-fixed/receive-float (or reverse) swap on a notional.",
     "params": [
         {"name": "fixed_rate", "kind": "float", "default": 0.04},
         {"name": "notional", "kind": "str", "default": "notes", "doc": "'notes', 'pool', or a schedule"},
         {"name": "pay_fixed", "kind": "bool", "default": True},
     ]},
    {"type": "rate_cap", "label": "Rate Cap", "group": "HEDGES",
     "doc": "Receive max(index - strike, 0) on a notional.",
     "params": [
         {"name": "strike", "kind": "float", "default": 0.05},
         {"name": "notional", "kind": "str", "default": "notes"},
     ]},
    {"type": "incentive_fee", "label": "Incentive Fee", "group": "FEES",
     "doc": "Manager incentive fee above an IRR hurdle.",
     "params": [
         {"name": "hurdle", "kind": "float", "default": 0.12},
         {"name": "share", "kind": "float", "default": 0.20},
     ]},
    {"type": "borrowing_base", "label": "Borrowing Base", "group": "FACILITY",
     "doc": "Margin-call principal when advances exceed advance_rate x pool.",
     "params": [
         {"name": "through", "kind": "bond", "default": None},
         {"name": "advance_rate", "kind": "float", "default": 0.85},
     ]},
    {"type": "draw", "label": "Draw", "group": "FACILITY",
     "doc": "Draw on a credit line during the draw period.",
     "params": [
         {"name": "bond", "kind": "bond", "default": None},
         {"name": "advance_rate", "kind": "float", "default": 0.85},
         {"name": "credit_line", "kind": "float", "default": 0.0},
         {"name": "until", "kind": "int", "default": 12},
     ]},
    {"type": "retain_collections", "label": "Retain Collections", "group": "FACILITY",
     "doc": "Recycle collections instead of paying down, until a month.",
     "params": [
         {"name": "until", "kind": "int", "default": 12},
         {"name": "fraction", "kind": "float", "default": 1.0},
     ]},
    {"type": "reinvest", "label": "Reinvest", "group": "FACILITY",
     "doc": "Reinvest principal into new collateral (drive with reinvestment runner).",
     "params": []},
]


@router.get("/schema/step-types")
def step_types() -> dict[str, Any]:
    return {"steps": STEP_SCHEMAS}


@router.get("/schema/trigger-metrics")
def trigger_metrics() -> dict[str, Any]:
    docs = {
        "cnl": "Cumulative net losses / original pool balance",
        "anl": "Annualized net loss rate (pair with window=3)",
        "oc": "Overcollateralization: pool / note balance",
        "ic": "Interest coverage: collections / note interest due",
        "pool_factor": "Pool balance / original pool balance",
        "excess_spread": "Annualized excess spread",
        "month": "Deal age in months (timers, calls, am events)",
        "deal_breach": "Any OC/IC breach in a named servicing step",
        "aux": "External monthly series passed via aux (e.g. delinquencies)",
    }
    return {
        "metrics": [{"name": m, "doc": docs.get(m, "")} for m in _BUILTIN_METRICS],
        "cure_options": ["auto", "never", "N"],
        "threshold_modes": ["scalar", "schedule"],
    }


@router.get("/schema/stress-scenarios")
def stress_scenarios() -> dict[str, Any]:
    curve = []
    for name, mult in STRESS_SCENARIOS.items():
        values = {k: v for k, v in dataclasses.asdict(mult).items()
                  if not (isinstance(v, (int, float)) and v in (1.0, 0))}
        curve.append({"name": name, "multipliers": clean(values)})
    macro = []
    for name, sc in MACRO_SCENARIOS.items():
        macro.append({"name": name, **clean({k: v for k, v in dataclasses.asdict(sc).items()})})
    return {
        "curve_scenarios": curve,
        "macro_scenarios": macro,
        "multiplier_fields": [f.name for f in dataclasses.fields(CurveStressMultipliers)],
    }


@router.get("/schema/samplers")
def samplers() -> dict[str, Any]:
    return {"samplers": [
        {"type": "lognormal", "label": "Lognormal multiplier", "target": "curve",
         "doc": "Multiplies the base curve by a lognormal draw with AR(1) persistence.",
         "params": [
             {"name": "sigma", "kind": "float", "default": 0.25, "doc": "Volatility (>= 0)"},
             {"name": "rho", "kind": "float", "default": 0.0, "doc": "Month-to-month persistence (-1, 1)"},
         ]},
        {"type": "normal_shift", "label": "Normal shift", "target": "curve",
         "doc": "Adds a normal draw to the base curve, floored at 0.",
         "params": [
             {"name": "sigma", "kind": "float", "default": 0.01, "doc": "Std dev of the additive shift"},
             {"name": "rho", "kind": "float", "default": 0.0},
         ]},
        {"type": "dirichlet_matrix", "label": "Dirichlet roll-rate", "target": "rr_matrix",
         "doc": "Resamples roll-rate matrix rows around the base matrix.",
         "params": [
             {"name": "concentration", "kind": "float", "default": 200.0,
              "doc": "Higher = tighter around the base matrix"},
         ]},
    ]}


@router.post("/parse/value")
def parse_value(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Parse term-sheet strings: {"text": "S+180", "kind": "rate"|"pct"}."""
    text = str(body.get("text", "")).strip()
    kind = body.get("kind", "rate")
    try:
        if kind == "pct":
            return {"ok": True, "value": clean(parse_pct(text))}
        floating, value = parse_rate(text)
        return {"ok": True, "floating": bool(floating), "value": clean(value)}
    except (ValueError, TypeError) as exc:
        return {"ok": False, "error": str(exc)}
