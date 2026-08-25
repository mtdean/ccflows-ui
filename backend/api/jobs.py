"""
ccflows-ui/backend/api/jobs.py
Background-job endpoints: submit (added per job kind), poll, result, cancel.
"""

from typing import Any

from fastapi import APIRouter, Body, HTTPException

from core import engine_bridge, jobs, workspace
from core.serialization import clean

router = APIRouter()


@router.post("/deals/{slug}/jobs/stress-matrix", status_code=202)
def submit_stress_matrix(slug: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """Two-way CDR× x CPR× grid: the full deal re-runs per cell, so the metric
    is a real waterfall-level tranche metric, with per-cell progress."""
    doc = body.get("doc") or workspace.load(slug)
    cdr_mults = [float(x) for x in body.get("cdr_multipliers") or (0.5, 1.0, 1.5, 2.0, 3.0)]
    cpr_mults = [float(x) for x in body.get("cpr_multipliers") or (0.5, 1.0, 2.0)]
    metric = str(body.get("metric") or "xirr")
    tranche = body.get("tranche")
    price = float(body.get("price") or 100.0)
    if metric not in ("xirr", "wal", "moic"):
        raise HTTPException(status_code=422, detail=f"Unsupported metric {metric!r}")

    def run(record: dict[str, Any]) -> dict[str, Any]:
        total = len(cdr_mults) * len(cpr_mults)
        record["progress"] = {"completed": 0, "total": total}
        # default tranche: the most junior funded note (most metric-sensitive)
        names = [b["name"] for b in (doc.get("waterfall") or {}).get("bonds", [])
                 if b.get("type") == "bond"]
        target = tranche if tranche in names else (names[-1] if names else None)
        cells = []
        done = 0
        for cm in cdr_mults:
            for pm in cpr_mults:
                if record["cancel"].is_set():
                    return {"metric": metric, "tranche": target, "cells": cells, "cancelled": True}
                value = None
                try:
                    cell_run = engine_bridge.run_deal(
                        doc, scenario="base", custom_multipliers={"cdr": cm, "cpr": pm})
                    metrics = engine_bridge.tranche_metrics(
                        cell_run.result, doc.get("waterfall") or {}, price)
                    if target is not None:
                        value = metrics.get(target, {}).get(
                            {"xirr": "xirr", "wal": "wal", "moic": "moic"}[metric])
                except Exception:  # noqa: BLE001 — a failed cell renders as em-dash
                    value = None
                cells.append({"cdr_mult": cm, "cpr_mult": pm, "value": value})
                done += 1
                record["progress"] = {"completed": done, "total": total}
        return {"metric": metric, "tranche": target, "cells": cells}

    record = jobs.submit("stress-matrix", slug, run,
                         params={"metric": metric, "cdr": cdr_mults, "cpr": cpr_mults})
    return jobs.public(record)


@router.post("/deals/{slug}/jobs/sensitivities", status_code=202)
def submit_sensitivities(slug: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """Factor sweeps + tornado on one tranche: CDR/CPR multipliers, rate
    shocks, macro scenarios. ~20 full deal re-runs -> background job."""
    doc = body.get("doc") or workspace.load(slug)
    tranche = body.get("tranche")
    if not tranche:
        raise HTTPException(status_code=422, detail="tranche is required")
    factors = [str(f) for f in (body.get("factors") or ["cdr", "cpr", "rate", "macro"])]
    bad = [f for f in factors if f not in ("cdr", "cpr", "rate", "macro")]
    if bad:
        raise HTTPException(status_code=422, detail=f"Unknown factors: {bad}")
    spread_bps = float(body.get("spread_bps") or 0.0)
    multipliers = tuple(float(x) for x in (body.get("multipliers") or (0.5, 1.0, 1.5, 2.0)))
    shocks_bps = tuple(float(x) for x in (body.get("shocks_bps") or (-100, -50, 0, 50, 100)))
    scenarios = tuple(str(s) for s in (body.get("scenarios")
                                       or ("baseline", "adverse", "severely_adverse")))

    def run(record: dict[str, Any]) -> dict[str, Any]:
        from cashflows import (
            cdr_sensitivity,
            cpr_sensitivity,
            macro_sensitivity,
            rate_sensitivity,
            sensitivity_summary,
        )

        from core import tracking

        tracked = tracking.build_tracked(doc, name=slug)
        total = len(factors) + 1
        record["progress"] = {"completed": 0, "total": total}
        fns = {
            "cdr": lambda: cdr_sensitivity(tracked, multipliers, spread_bps=spread_bps, tranche=tranche),
            "cpr": lambda: cpr_sensitivity(tracked, multipliers, spread_bps=spread_bps, tranche=tranche),
            "rate": lambda: rate_sensitivity(tracked, shocks_bps, spread_bps=spread_bps, tranche=tranche),
            "macro": lambda: macro_sensitivity(tracked, scenarios, spread_bps=spread_bps, tranche=tranche),
        }
        out_factors: dict[str, Any] = {}
        done = 0
        for f in factors:
            if record["cancel"].is_set():
                break
            df = fns[f]()
            out_factors[f] = {
                "records": df.to_dict(orient="records"),
                "columns": [str(c) for c in df.columns],
                "attrs": {k: v for k, v in df.attrs.items()},
            }
            done += 1
            record["progress"] = {"completed": done, "total": total}
        tornado = sensitivity_summary(tracked, factors=tuple(factors),
                                      spread_bps=spread_bps, tranche=tranche)
        record["progress"] = {"completed": total, "total": total}
        return {
            "tranche": tranche,
            "spread_bps": spread_bps,
            "tornado": tornado.to_dict(orient="records"),
            "factors": out_factors,
        }

    record = jobs.submit("sensitivities", slug, run,
                         params={"tranche": tranche, "factors": factors})
    return jobs.public(record)


@router.post("/deals/{slug}/jobs/tranche-mc", status_code=202)
def submit_tranche_mc(slug: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """Tranche-level Monte Carlo: sampled collateral paths, the SAME waterfall
    run over each, reduced to per-tranche outcome distributions."""
    doc = body.get("doc") or workspace.load(slug)
    n_sims = int(body.get("n_sims") or 500)
    if n_sims < 1 or n_sims > 2000:
        raise HTTPException(status_code=422,
                            detail="n_sims must be 1..2000 (each sim is a full deal run)")
    seed = int(body.get("seed") if body.get("seed") is not None else 42)
    sampler_cfgs = body.get("samplers") or (doc.get("monte_carlo") or {}).get("samplers") or []
    if not sampler_cfgs:
        raise HTTPException(status_code=422, detail="At least one sampler is required")
    if ((doc.get("run") or {}).get("originations") or {}).get("schedule"):
        raise HTTPException(status_code=422,
                            detail="Tranche MC is not supported on forward-flow pools")
    if (doc.get("actuals") or {}).get("collateral"):
        raise HTTPException(status_code=422,
                            detail="Tranche MC runs on projections — remove/ignore actuals "
                                   "(v1 limitation)")
    spreads = body.get("spreads")

    def run(record: dict[str, Any]) -> dict[str, Any]:
        from cashflows import Cashflow
        from cashflows.liabilities.spec import waterfall_from_dict
        from cashflows.simulation.samplers import LognormalCurveSampler, NormalShiftSampler
        from cashflows.valuation import mark_distribution

        from core import engine_bridge as eb

        replines, warns = eb.build_replines(doc)
        run_date = str((doc.get("run") or {}).get("run_date") or "2026-01-01")
        _, models, _ = eb.run_collateral(replines, doc.get("rates"), run_date)
        if len(models) > 1:
            raise ValueError("Tranche MC needs a single collateral engine type")
        model = models[0]
        wf = waterfall_from_dict(doc.get("waterfall") or {})

        samplers = {}
        valid_fields = set(type(replines[0]).__dataclass_fields__)
        for cfg in sampler_cfgs:
            field = str(cfg.get("field") or "cdr")
            if field not in valid_fields:
                raise ValueError(f"Sampler field {field!r} is not a repline field")
            base = getattr(replines[0], field)
            kind = str(cfg.get("type") or "lognormal")
            if kind == "lognormal":
                samplers[field] = LognormalCurveSampler(
                    base, sigma=float(cfg.get("sigma", 0.25)), rho=float(cfg.get("rho", 0.0)))
            elif kind == "normal_shift":
                samplers[field] = NormalShiftSampler(base, scale=float(cfg.get("sigma", 0.01)))
            else:
                raise ValueError(f"Sampler type {kind!r} not supported for tranche MC")

        cf_spec = Cashflow(model, transforms=_call_transforms(doc))
        record["progress"] = {"completed": 0, "total": n_sims * 2}
        pools = cf_spec.sample(samplers, n_sims=n_sims, seed=seed)
        record["progress"] = {"completed": n_sims, "total": n_sims * 2}

        names = [b["name"] for b in (doc.get("waterfall") or {}).get("bonds", [])]
        xirr, moic, wal, writedown, residual = [], [], [], [], []
        results = []
        for i, pool in enumerate(pools):
            if record["cancel"].is_set():
                break
            res = wf.run(pool)
            results.append(res)
            xirr.append(res.xirr(price=100.0))
            moic.append(res.moic())
            wal.append(res.wal())
            writedown.append(res.tranche_writedown.sum(axis=1))
            residual.append(float(res.residual_excess.sum()))
            record["progress"] = {"completed": n_sims + i + 1, "total": n_sims * 2}

        import numpy as np

        xirr_a = np.asarray(xirr)      # (n, n_tranches)
        moic_a = np.asarray(moic)
        wal_a = np.asarray(wal)
        wd_a = np.asarray(writedown)
        qs = [5, 25, 50, 75, 95]

        def stats(arr: np.ndarray, j: int) -> dict[str, Any]:
            col = arr[:, j]
            col = col[np.isfinite(col)]
            if col.size == 0:
                return {}
            pct = np.percentile(col, qs)
            return {"mean": float(col.mean()),
                    **{f"p{q}": float(pct[k]) for k, q in enumerate(qs)}}

        tranche_stats = []
        histograms = {}
        for j, name in enumerate(names):
            tranche_stats.append({
                "tranche": name,
                "xirr": stats(xirr_a, j),
                "moic": stats(moic_a, j),
                "wal": stats(wal_a, j),
                "writedown": stats(wd_a, j),
                "prob_writedown": float((wd_a[:, j] > 1.0).mean()),
            })
            col = xirr_a[:, j]
            col = col[np.isfinite(col)]
            if col.size:
                counts, edges = np.histogram(col, bins=min(25, max(8, len(col) // 15)))
                histograms[name] = [
                    {"bin_left": float(edges[k]), "bin_right": float(edges[k + 1]),
                     "count": int(cnt)} for k, cnt in enumerate(counts)]

        res_arr = np.asarray(residual)
        res_pct = np.percentile(res_arr, qs) if res_arr.size else []
        price_dist = None
        if spreads is not None and results:
            price_dist = mark_distribution(
                results,
                spreads if isinstance(spreads, (int, float)) else dict(spreads))

        return {
            "n_sims": len(results), "seed": seed, "warnings": warns,
            "tranches": tranche_stats,
            "histograms": histograms,
            "residual_cash": ({"mean": float(res_arr.mean()),
                               **{f"p{q}": float(res_pct[k]) for k, q in enumerate(qs)}}
                              if res_arr.size else None),
            "price_distribution": price_dist,
        }

    record = jobs.submit("tranche-mc", slug, run, params={"n_sims": n_sims, "seed": seed})
    return jobs.public(record)


def _call_transforms(doc: dict[str, Any]) -> list:
    """doc.call -> Cashflow transforms list (empty when disabled)."""
    call_cfg = doc.get("call") or {}
    if not call_cfg.get("enabled"):
        return []
    from cashflows import Call

    return [("call", Call(
        call_month=call_cfg.get("call_month"),
        nc_months=int(call_cfg.get("nc_months") or 0),
        call_price_pct=float(call_cfg.get("call_price_pct") or 100.0),
        clean_up_call=bool(call_cfg.get("clean_up_call")),
        clean_up_call_pct=float(call_cfg.get("clean_up_call_pct") or 0.10),
    ))]


@router.post("/deals/{slug}/jobs/breakeven", status_code=202)
def submit_breakeven(slug: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """Principal breakevens: solve the loss-curve multiplier at which each
    tranche's cumulative cash exactly returns its purchase price. Re-runs the
    whole deal per solver iterate, hence a background job."""
    doc = body.get("doc") or workspace.load(slug)
    curve = str(body.get("curve") or "cdr")
    price = body.get("price") or 100.0
    tranches = body.get("tranches")
    max_multiplier = float(body.get("max_multiplier") or 50.0)
    if curve not in ("cdr", "cgl"):
        raise HTTPException(status_code=422, detail="curve must be 'cdr' or 'cgl'")

    def run(record: dict[str, Any]) -> dict[str, Any]:
        from cashflows.liabilities import principal_breakeven
        from cashflows.liabilities.spec import waterfall_from_dict

        deal_run = engine_bridge.run_deal(doc, scenario="base")
        if deal_run.is_portfolio:
            raise ValueError("Breakevens are not supported on forward-flow origination "
                             "pools — the vintage build-up cannot be re-run per solver "
                             "iterate. Analyze a static-pool version of the deal.")
        if len(deal_run.models) > 1:
            raise ValueError(
                "Breakevens need a single collateral engine type; this pool mixes "
                f"{len(deal_run.models)} engine types. Split the pool to analyze.")
        model = deal_run.models[0]
        wf = waterfall_from_dict(doc.get("waterfall") or {})
        df = principal_breakeven(
            model, wf,
            tranches=tranches,
            curve=curve,
            price=price if isinstance(price, (int, float)) else dict(price),
            max_multiplier=max_multiplier,
        )
        return {
            "curve": curve,
            "max_multiplier": max_multiplier,
            "condition": str(df.attrs.get("breakeven_condition", "")),
            "rows": df.to_dict(orient="records"),
        }

    record = jobs.submit("breakeven", slug, run,
                         params={"curve": curve, "max_multiplier": max_multiplier})
    return jobs.public(record)


@router.post("/deals/{slug}/jobs/monte-carlo", status_code=202)
def submit_monte_carlo(slug: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """Monte Carlo over the deal's collateral: sampled assumption curves ->
    distributions of collateral-level XIRR / WAL / loss / MOIC, VaR/ES, and
    percentile cashflow fan paths."""
    doc = body.get("doc") or workspace.load(slug)
    mc_cfg = {**(doc.get("monte_carlo") or {}), **{k: v for k, v in body.items() if k != "doc"}}
    n_sims = int(mc_cfg.get("n_sims") or 1000)
    seed = mc_cfg.get("seed")
    seed = int(seed) if seed is not None else None
    store_paths = bool(mc_cfg.get("store_paths", True))
    sampler_cfgs = mc_cfg.get("samplers") or []
    if n_sims < 1 or n_sims > 100_000:
        raise HTTPException(status_code=422, detail="n_sims must be between 1 and 100000")
    if not sampler_cfgs:
        raise HTTPException(status_code=422, detail="At least one sampler is required")
    if ((doc.get("run") or {}).get("originations") or {}).get("schedule"):
        raise HTTPException(status_code=422, detail=(
            "Monte Carlo is not supported on forward-flow origination pools yet — "
            "run it on a static-pool version of the deal"))

    def run(record: dict[str, Any]) -> dict[str, Any]:
        import numpy as np

        from cashflows.registry import get_collateral_class
        from cashflows.simulation import run_monte_carlo
        from cashflows.simulation.samplers import (
            DirichletMatrixSampler,
            LognormalCurveSampler,
            NormalShiftSampler,
        )

        from core.rates import build_rates, rates_index

        replines, warns = engine_bridge.build_replines(doc)
        run_date = str((doc.get("run") or {}).get("run_date") or "2026-01-01")
        rates = build_rates(doc.get("rates"), run_date)
        model_cls = get_collateral_class(str(replines[0].amortization_type))
        if len({str(r.amortization_type) for r in replines}) > 1:
            warns.append("Monte Carlo uses the first repline's engine for all replines "
                         f"({model_cls.__name__}); split mixed-type pools for exact MC.")

        samplers = {}
        for cfg in sampler_cfgs:
            field = str(cfg.get("field") or "cdr")
            kind = str(cfg.get("type") or "lognormal")
            base = getattr(replines[0], field, None)
            if base is None:
                raise ValueError(f"Sampler field {field!r} is not set on the repline")
            if kind == "lognormal":
                samplers[field] = LognormalCurveSampler(
                    base, sigma=float(cfg.get("sigma", 0.25)), rho=float(cfg.get("rho", 0.0)))
            elif kind == "normal_shift":
                samplers[field] = NormalShiftSampler(
                    base, scale=float(cfg.get("sigma", 0.01)))
            elif kind == "dirichlet_matrix":
                samplers[field] = DirichletMatrixSampler(
                    base, concentration=float(cfg.get("concentration", 200.0)))
            else:
                raise ValueError(f"Unknown sampler type {kind!r}")

        record["progress"] = {"completed": 0, "total": n_sims}
        results = run_monte_carlo(
            replines if len(replines) > 1 else replines[0],
            rates, run_date, model_cls=model_cls, samplers=samplers,
            n_sims=n_sims, seed=seed, store_paths=store_paths,
            index_rate=rates_index(doc.get("rates")),
        )
        record["progress"] = {"completed": n_sims, "total": n_sims}

        summary_df = results.summary()
        metric_names = list(getattr(results, "xirr", None) is not None and
                            ("xirr", "wal", "cumulative_loss_rate", "moic") or ())
        histograms = {}
        var = {}
        es = {}
        for m in metric_names:
            arr = np.asarray(results.metric(m), dtype=float)
            arr = arr[np.isfinite(arr)]
            if arr.size == 0:
                continue
            counts, edges = np.histogram(arr, bins=min(30, max(8, n_sims // 20)))
            histograms[m] = [
                {"bin_left": float(edges[i]), "bin_right": float(edges[i + 1]), "count": int(c)}
                for i, c in enumerate(counts)
            ]
            try:
                var[m] = float(results.var(q=0.95, metric=m))
                es[m] = float(results.expected_shortfall(q=0.95, metric=m))
            except Exception:  # noqa: BLE001
                var[m] = None
                es[m] = None

        percentile_paths = None
        if store_paths and results.cashflow_paths is not None:
            qs = [0.05, 0.25, 0.50, 0.75, 0.95]
            paths = results.percentile_paths(qs)
            percentile_paths = {
                f"p{int(q * 100)}": [float(x) for x in paths[i]] for i, q in enumerate(qs)
            }

        summary = summary_df.reset_index()
        summary = summary.rename(columns={summary.columns[0]: "metric"})
        return {
            "n_sims": n_sims,
            "seed": seed,
            "warnings": warns,
            "summary": {"columns": [str(c) for c in summary.columns],
                        "records": summary.to_dict(orient="records")},
            "var": var,
            "expected_shortfall": es,
            "histograms": histograms,
            "percentile_paths": percentile_paths,
        }

    record = jobs.submit("monte-carlo", slug, run,
                         params={"n_sims": n_sims, "seed": seed})
    return jobs.public(record)


@router.get("/jobs")
def get_jobs() -> list[dict[str, Any]]:
    return jobs.list_jobs()


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    return jobs.public(job)


@router.get("/jobs/{job_id}/result")
def get_job_result(job_id: str) -> Any:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    if job["status"] in ("queued", "running"):
        raise HTTPException(status_code=409, detail=f"Job is {job['status']}")
    if job["status"] == "error":
        raise HTTPException(status_code=422, detail=f"Job failed: {job['error']['message']}")
    if job["status"] == "cancelled":
        raise HTTPException(status_code=410, detail="Job was cancelled")
    return clean(job["result"])


@router.delete("/jobs/{job_id}")
def delete_job(job_id: str) -> dict[str, Any]:
    if not jobs.cancel(job_id):
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    return {"cancelled": True}
