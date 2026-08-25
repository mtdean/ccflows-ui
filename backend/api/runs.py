"""
ccflows-ui/backend/api/runs.py
Synchronous deal runs (seconds-scale) + result retrieval. Runs accept the
draft document in the request body so previewing never requires saving.
"""

from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query

from api.errors import engine_error_msg
from core import engine_bridge, results_store, workspace
from core.results_store import RunRecord
from core.serialization import clean, df_records

router = APIRouter()


def _record_or_410(run_id: str) -> RunRecord:
    record = results_store.get(run_id)
    if record is None:
        raise HTTPException(status_code=410, detail="Run expired — re-run the deal")
    return record


@router.post("/deals/{slug}/run")
def post_run(slug: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    doc = body.get("doc") or workspace.load(slug)
    scenario = str(body.get("scenario") or "base")
    price = float(body.get("price") or 100.0)
    try:
        run = engine_bridge.run_deal(
            doc,
            scenario=scenario,
            custom_multipliers=body.get("custom_multipliers"),
            macro_scenario=body.get("macro_scenario"),
        )
    except (ValueError, TypeError, KeyError) as exc:
        info = engine_error_msg(exc if not isinstance(exc, KeyError) else ValueError(f"Unknown reference: {exc}"))
        raise HTTPException(status_code=422, detail={"errors": [
            {"loc": [], "field": None, "msg": info["msg"], "hint": info["hint"]},
        ]}) from exc

    record = RunRecord(
        run_id=results_store.new_id(),
        deal_slug=slug,
        scenario=scenario,
        price=price,
        result=run.result,
        collateral=run.collateral,
        waterfall_spec=doc.get("waterfall") or {},
        models=run.models,
        waterfall_obj=run.waterfall,
        warnings=run.warnings,
        is_portfolio=run.is_portfolio,
        boundary_month=run.boundary_month,
        reinvestment=run.reinvestment,
    )
    results_store.put(record)
    return _summary_payload(record)


def _summary_payload(record: RunRecord) -> dict[str, Any]:
    return clean({
        "run_id": record.run_id,
        "scenario": record.scenario,
        "summary": df_records(record.result.stack_summary(price=record.price)),
        "tranche_metrics": engine_bridge.tranche_metrics(
            record.result, record.waterfall_spec, record.price),
        "warnings": record.warnings,
        "is_portfolio": record.is_portfolio,
        "boundary_month": record.boundary_month,
        "reinvestment": record.reinvestment,
    })


@router.get("/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    return _summary_payload(_record_or_410(run_id))


@router.get("/runs/{run_id}/stack")
def get_stack(run_id: str, price: float = Query(100.0)) -> dict[str, Any]:
    record = _record_or_410(run_id)
    return clean(df_records(record.result.stack_summary(price=price)))


@router.get("/runs/{run_id}/tranches/{name}/cashflows")
def get_tranche_cashflows(run_id: str, name: str) -> dict[str, Any]:
    record = _record_or_410(run_id)
    try:
        df = record.result[name]
    except (KeyError, IndexError) as exc:
        raise HTTPException(status_code=404, detail=f"No tranche named {name!r}") from exc
    return clean(df_records(df.reset_index(drop=True)))


@router.get("/runs/{run_id}/collateral/cashflows")
def get_collateral_cashflows(run_id: str, columns: str | None = Query(None)) -> dict[str, Any]:
    record = _record_or_410(run_id)
    df = record.collateral.to_dataframe()
    if columns:
        wanted = [c for c in columns.split(",") if c in df.columns]
        df = df[wanted]
    return clean(df_records(df.reset_index()))


@router.get("/runs/{run_id}/reinvestment")
def get_reinvestment_series(run_id: str) -> dict[str, Any]:
    """Monthly reinvested spend/faces for the reinvestment chart."""
    record = _record_or_410(run_id)
    result = record.result
    spend = getattr(result, "reinvested_principal", None)
    faces = getattr(result, "reinvested_faces", None)
    if spend is None or float(spend.sum()) == 0:
        raise HTTPException(status_code=404, detail="No reinvestment in this run")
    return clean({
        "months": list(range(len(spend))),
        "spend": list(spend),
        "faces": list(faces) if faces is not None else None,
        "info": record.reinvestment,
    })


@router.get("/runs/{run_id}/balances")
def get_balances(run_id: str) -> dict[str, Any]:
    """Per-tranche end-of-month balances + pool balance, for the stacked chart."""
    record = _record_or_410(run_id)
    result = record.result
    names = [b["name"] for b in record.waterfall_spec.get("bonds", [])]
    balances = {}
    for i, name in enumerate(names):
        try:
            balances[name] = list(result.tranche_balance_end[i])
        except (AttributeError, IndexError):
            continue
    return clean({
        "months": list(range(len(record.result.pool_balance_end))),
        "pool": list(result.pool_balance_end),
        "tranches": balances,
    })


@router.get("/runs/{run_id}/triggers")
def get_triggers(run_id: str) -> dict[str, Any]:
    record = _record_or_410(run_id)
    result = record.result
    thresholds = {t["name"]: t.get("threshold") for t in record.waterfall_spec.get("triggers", [])}
    out: dict[str, Any] = {}
    for name, values in result.trigger_values.items():
        out[name] = {
            "values": list(values),
            "breached": [bool(b) for b in result.trigger_breached.get(name, [])],
            "threshold": thresholds.get(name),
        }
    return clean(out)


@router.get("/runs/{run_id}/explain/{month}")
def get_explain(run_id: str, month: int) -> dict[str, Any]:
    record = _record_or_410(run_id)
    try:
        return {"text": record.result.explain(month)}
    except (IndexError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
