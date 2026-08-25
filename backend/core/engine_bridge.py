"""
ccflows-ui/backend/core/engine_bridge.py
The only module that drives the cashflows engine deeply: deal document ->
replines -> collateral model(s) -> waterfall -> WaterfallResult.
"""

import warnings
from typing import Any

from cashflows.dataclasses.curves import STRESS_SCENARIOS, CurveStressMultipliers
from cashflows.dataclasses.repline import ReplineInputs, stack_replines
from cashflows.dataclasses.run_config import ReplineConfig
from cashflows.liabilities.spec import waterfall_from_dict
from cashflows.registry import get_collateral_class
from cashflows.scenarios import get_macro_scenario, stress_repline
from cashflows.serialize.recipe import repline_from_dict

from .rates import build_rates, rates_index


def build_replines(doc: dict[str, Any]) -> tuple[list[ReplineInputs], list[str]]:
    """Deal doc -> ReplineInputs list; strict percent-conversion warnings collected."""
    replines: list[ReplineInputs] = []
    warns: list[str] = []
    for i, entry in enumerate((doc.get("run") or {}).get("replines") or []):
        payload = dict(entry.get("inline") or {})
        payload["percent_conversion"] = "strict"
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            replines.append(repline_from_dict(payload))
        warns.extend(f"repline[{i}]: {w.message}" for w in caught)
    if not replines:
        raise ValueError("Deal has no replines")
    return replines, warns


def resolve_stress(scenario: str | None,
                   custom: dict[str, Any] | None) -> CurveStressMultipliers | None:
    """Scenario name / custom multiplier dict -> CurveStressMultipliers."""
    if custom:
        return CurveStressMultipliers(**custom)
    if scenario and scenario != "base":
        if scenario in STRESS_SCENARIOS:
            return STRESS_SCENARIOS[scenario]
        raise ValueError(f"Unknown stress scenario {scenario!r} "
                         f"(known: {', '.join(STRESS_SCENARIOS)})")
    return None


def apply_stress(replines: list[ReplineInputs],
                 mult: CurveStressMultipliers | None,
                 macro: str | None) -> list[ReplineInputs]:
    out = replines
    if mult is not None:
        out = [ReplineConfig(repline=r, stress=mult).get_final_repline() for r in out]
    if macro:
        scenario = get_macro_scenario(macro)
        out = [stress_repline(r, scenario) for r in out]
    return out


def run_collateral(replines: list[ReplineInputs], rates_section: dict[str, Any] | None,
                   run_date: str,
                   originations: dict[str, Any] | None = None) -> tuple[Any, list[Any], bool]:
    """Group replines by engine class, run each stacked group, sum the models.

    Returns (summed model, list of the individual group models, is_portfolio).
    Analysis endpoints (breakevens, sensitivities) need real engine instances,
    which a summed or vintage-built model is not.

    When `originations` carries a non-empty dollar `schedule`, the pool is a
    forward-flow build-up: `build_portfolio` clones the replines per vintage
    month along the origination schedule (replines' `distribution` weights set
    the cross-sectional mix).
    """
    rates = build_rates(rates_section, run_date)
    index = rates_index(rates_section)

    schedule = list((originations or {}).get("schedule") or [])
    if schedule and any(float(x) > 0 for x in schedule):
        import numpy as np

        from cashflows import OriginationInputs, build_portfolio

        classes = {get_collateral_class(str(r.amortization_type)) for r in replines}
        if len(classes) > 1:
            raise ValueError("Forward-flow origination pools need a single collateral "
                             "engine type across replines")
        # distribution weights must exist; default to equal weights
        if all(float(getattr(r, "distribution", 0) or 0) == 0 for r in replines):
            replines = [ReplineConfig(repline=r).get_final_repline() for r in replines]
            for r in replines:
                r.distribution = 1.0 / len(replines)
        portfolio = build_portfolio(
            next(iter(classes)), replines,
            OriginationInputs(dollar_originations=np.asarray(schedule, dtype=float)),
            rates, run_date=run_date, index_rate=index)
        return portfolio, [portfolio], True

    groups: dict[type, list[ReplineInputs]] = {}
    for r in replines:
        cls = get_collateral_class(str(r.amortization_type))
        groups.setdefault(cls, []).append(r)
    total = None
    models: list[Any] = []
    for cls, group in groups.items():
        model = cls(repline=stack_replines(group), rates=rates, run_date=run_date,
                    index_rate=index)
        model.run()
        models.append(model)
        total = model if total is None else total + model
    return total, models, False


def run_deal(doc: dict[str, Any], scenario: str = "base",
             custom_multipliers: dict[str, Any] | None = None,
             macro_scenario: str | None = None) -> "DealRun":
    """Full pipeline: doc -> DealRun(result, collateral, models, waterfall, warnings)."""
    replines, warns = build_replines(doc)
    stress_section = doc.get("stress") or {}
    mult = resolve_stress(scenario, custom_multipliers)
    macro = macro_scenario or (stress_section.get("macro_scenario") if scenario == "__doc__" else None)
    replines = apply_stress(replines, mult, macro)

    wf_spec = doc.get("waterfall")
    if not wf_spec:
        raise ValueError("Deal has no waterfall structure")
    wf = waterfall_from_dict(wf_spec)

    run_date = str((doc.get("run") or {}).get("run_date") or "2026-01-01")
    originations = (doc.get("run") or {}).get("originations")
    collateral, models, is_portfolio = run_collateral(
        replines, doc.get("rates"), run_date, originations)

    # Actuals: splice the remittance tape ahead of the (already stressed)
    # projection, re-anchoring forward curves at the boundary.
    actual_rows = (doc.get("actuals") or {}).get("collateral") or []
    boundary_month = None
    source: Any = collateral
    aux = None
    if actual_rows:
        if is_portfolio:
            raise ValueError("Actuals splicing is not supported on forward-flow "
                             "origination pools yet")
        if len(models) > 1:
            raise ValueError("Actuals splicing needs a single collateral engine type; "
                             "split mixed pools first")
        import pandas as pd

        from cashflows.actuals import RemittanceData, splice_actuals

        remit = RemittanceData(pd.DataFrame(actual_rows))
        spliced = splice_actuals(models[0], remit)
        boundary_month = int(spliced.boundary_month)
        source = _SplicedPoolSource(spliced)
        warns.append(f"Spliced {boundary_month} month(s) of actuals ahead of projections")
    elif is_portfolio:
        from cashflows.liabilities import warehouse_aux, warehouse_pool

        source = warehouse_pool(collateral)
        aux = warehouse_aux(collateral)

    call_cfg = doc.get("call") or {}
    reinvest_cfg = doc.get("reinvestment") or {}
    reinvest_info: dict[str, Any] | None = None

    if reinvest_cfg.get("enabled"):
        if boundary_month is not None or is_portfolio:
            raise ValueError("Reinvestment cannot combine with actuals or "
                             "forward-flow originations")
        if len(models) > 1:
            raise ValueError("Reinvestment needs a single collateral engine type")
        result = _run_reinvestment(wf, models[0], reinvest_cfg, call_cfg, replines, doc)
        reinvest_info = {
            "total_spend": float(result.reinvested_principal.sum()),
            "total_faces": float(result.reinvested_faces.sum()),
            "iterations": int(getattr(result, "reinvestment_iterations", 0)),
            "call_month_effective": getattr(result, "call_month_effective", None),
        }
    else:
        if call_cfg.get("enabled"):
            if boundary_month is not None or is_portfolio:
                raise ValueError("Call mechanics cannot combine with actuals or "
                                 "forward-flow originations yet")
            if len(models) > 1:
                raise ValueError("Call mechanics need a single collateral engine type")
            from cashflows import Cashflow

            call = build_call(call_cfg)
            spec = Cashflow(models[0], transforms=[("call", call)])
            result = wf.run(spec)
            # resolve against the *uncalled* pool for reporting
            reinvest_info = {
                "call_month_effective": call.resolve_month(Cashflow(models[0]).pool())}
        else:
            result = wf.run(source, aux=aux)

    return DealRun(result=result, collateral=collateral, models=models,
                   waterfall=wf, warnings=warns, is_portfolio=is_portfolio,
                   boundary_month=boundary_month, reinvestment=reinvest_info)


def build_call(cfg: dict[str, Any]) -> Any:
    from cashflows import Call

    call_month = cfg.get("call_month")
    clean_up = bool(cfg.get("clean_up_call"))
    if call_month is None and not clean_up:
        raise ValueError("Call needs a call_month or clean_up_call enabled")
    return Call(
        call_month=int(call_month) if call_month is not None else None,
        nc_months=int(cfg.get("nc_months") or 0),
        call_price_pct=float(cfg.get("call_price_pct") or 100.0),
        clean_up_call=clean_up,
        clean_up_call_pct=float(cfg.get("clean_up_call_pct") or 0.10),
    )


def _run_reinvestment(wf: Any, model: Any, cfg: dict[str, Any],
                      call_cfg: dict[str, Any], replines: list[ReplineInputs],
                      doc: dict[str, Any]) -> Any:
    from cashflows import ReinvestmentSpec
    from cashflows.liabilities import run_with_reinvestment

    template_id = cfg.get("template_repline_id")
    template = None
    for r in replines:
        if str(r.repline_id) == str(template_id):
            template = r
            break
    if template is None:
        template = replines[0]
    spec = ReinvestmentSpec(
        reinvest_months=int(cfg.get("reinvest_months") or 12),
        template=template,
        purchase_price_pct=float(cfg.get("purchase_price_pct") or 100.0),
        reinvest_share=float(cfg.get("reinvest_share") if cfg.get("reinvest_share")
                             is not None else 1.0),
        max_iterations=int(cfg.get("max_iterations") or 5),
        index_rate=rates_index(doc.get("rates")),
    )
    call = build_call(call_cfg) if call_cfg.get("enabled") else None
    return run_with_reinvestment(wf, model, spec, call=call)


class _SplicedPoolSource:
    """Adapter that lets ``Waterfall.run`` aggregate a ``SplicedCashflows``
    via ``PoolCashflows.from_model``: delegates to the spliced arrays, falls
    back to the underlying model (``repline``, ``dates``...), and zero-fills
    ``upb_schedprin`` (the splice keeps actual principal in ``upb_prinpay``,
    which ``from_model`` prefers anyway)."""

    def __init__(self, spliced: Any):
        self._spliced = spliced

    def __getattr__(self, name: str) -> Any:
        spliced = object.__getattribute__(self, "_spliced")
        if hasattr(spliced, name):
            return getattr(spliced, name)
        if name == "upb_schedprin":
            import numpy as np

            return np.zeros_like(spliced.upb_prinpay)
        return getattr(spliced.model, name)


class DealRun:
    """Everything one engine run produced, kept together for analysis reuse."""

    def __init__(self, result: Any, collateral: Any, models: list[Any],
                 waterfall: Any, warnings: list[str], is_portfolio: bool = False,
                 boundary_month: int | None = None,
                 reinvestment: dict[str, Any] | None = None):
        self.result = result
        self.collateral = collateral
        self.models = models
        self.waterfall = waterfall
        self.warnings = warnings
        self.is_portfolio = is_portfolio
        self.boundary_month = boundary_month
        self.reinvestment = reinvestment


def tranche_metrics(result: Any, spec: dict[str, Any], price: float) -> dict[str, dict[str, Any]]:
    """Per-tranche metric dict keyed by bond name."""
    names = [b["name"] for b in spec.get("bonds", [])]

    def safe(fn, default=None):
        try:
            return fn()
        except Exception:  # noqa: BLE001 — individual metrics may not apply
            return default

    wal = safe(lambda: result.wal())
    xirr = safe(lambda: result.xirr(price))
    dm = safe(lambda: result.discount_margin(price))
    moic = safe(lambda: result.moic(price))
    ce = safe(lambda: result.credit_enhancement(), {}) or {}
    ad = safe(lambda: result.attach_detach(), {}) or {}

    out: dict[str, dict[str, Any]] = {}
    for i, name in enumerate(names):
        pair = ad.get(name)
        out[name] = {
            "wal": None if wal is None or i >= len(wal) else float(wal[i]),
            "xirr": None if xirr is None or i >= len(xirr) else float(xirr[i]),
            "discount_margin": None if dm is None or i >= len(dm) else float(dm[i]),
            "moic": None if moic is None or i >= len(moic) else float(moic[i]),
            "credit_enhancement": ce.get(name),
            "attach": None if not pair else float(pair[0]),
            "detach": None if not pair else float(pair[1]),
        }
    return out
