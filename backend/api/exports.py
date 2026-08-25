"""
ccflows-ui/backend/api/exports.py
Exports to a target folder with a standardized naming convention:

    {export_root}/{deal_slug}/{YYYYMMDD}_{HHMMSS}_{scenario}_{artifact}.{ext}

e.g. exports/my-auto-deal/20260824_143012_severe_stress_stack.xlsx
Also offers the same artifacts as direct browser downloads.
"""

import json
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import FileResponse

import config
from core import jobs as jobstore
from core import results_store
from core.results_store import RunRecord
from core.serialization import clean

router = APIRouter()

RUN_ARTIFACTS = ("deal", "stack", "collateral", "triggers")
FORMATS = ("xlsx", "csv", "json")


def _slug_part(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(text).lower()).strip("_") or "x"


def _filename(scenario: str, artifact: str, ext: str) -> str:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{stamp}_{_slug_part(scenario)}_{_slug_part(artifact)}.{ext}"


def _target_dir(slug: str, folder: str | None) -> Path:
    base = Path(folder).expanduser() if folder else config.EXPORT_DIR / slug
    base.mkdir(parents=True, exist_ok=True)
    return base


def _record_or_410(run_id: str) -> RunRecord:
    record = results_store.get(run_id)
    if record is None:
        raise HTTPException(status_code=410, detail="Run expired — re-run the deal")
    return record


def _run_frame(record: RunRecord, artifact: str) -> pd.DataFrame:
    if artifact == "stack":
        return record.result.stack_summary(price=record.price)
    if artifact == "collateral":
        return record.collateral.to_dataframe().reset_index()
    if artifact == "triggers":
        rows = []
        for name, values in record.result.trigger_values.items():
            breached = record.result.trigger_breached.get(name, [])
            for m, v in enumerate(values):
                rows.append({"trigger": name, "month": m, "value": v,
                             "breached": bool(breached[m]) if m < len(breached) else None})
        return pd.DataFrame(rows)
    raise HTTPException(status_code=422, detail=f"Unknown artifact {artifact!r}")


def _write_run_artifact(record: RunRecord, artifact: str, fmt: str, path: Path) -> None:
    if artifact == "deal":
        if fmt != "xlsx":
            raise HTTPException(status_code=422, detail="artifact 'deal' exports as xlsx only")
        record.result.to_excel(str(path), price=record.price)
        return
    df = _run_frame(record, artifact)
    if fmt == "csv":
        df.to_csv(path, index=False)
    elif fmt == "json":
        path.write_text(json.dumps(clean(df.to_dict(orient="records")), indent=1))
    elif fmt == "xlsx":
        df.to_excel(path, index=False)


@router.post("/runs/{run_id}/export")
def export_run(run_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    record = _record_or_410(run_id)
    fmt = str(body.get("format") or "xlsx")
    artifact = str(body.get("artifact") or "deal")
    if fmt not in FORMATS:
        raise HTTPException(status_code=422, detail=f"format must be one of {FORMATS}")
    if artifact not in RUN_ARTIFACTS:
        raise HTTPException(status_code=422, detail=f"artifact must be one of {RUN_ARTIFACTS}")
    target = _target_dir(record.deal_slug, body.get("folder"))
    path = target / _filename(record.scenario, artifact, fmt)
    _write_run_artifact(record, artifact, fmt, path)
    return {"path": str(path), "filename": path.name}


@router.get("/runs/{run_id}/export/download")
def download_run_artifact(run_id: str, format: str = Query("xlsx"),
                          artifact: str = Query("deal")) -> FileResponse:
    record = _record_or_410(run_id)
    tmp = Path(tempfile.mkdtemp(prefix="ccflows-export-"))
    path = tmp / _filename(record.scenario, artifact, format)
    _write_run_artifact(record, artifact, format, path)
    return FileResponse(path, filename=path.name)


@router.post("/jobs/{job_id}/export")
def export_job(job_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    job = jobstore.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    if job["status"] != "done":
        raise HTTPException(status_code=409, detail=f"Job is {job['status']}")
    fmt = str(body.get("format") or "csv")
    result = job["result"] or {}
    if job["kind"] == "monte-carlo":
        artifact = f"mc{job['params'].get('n_sims', '')}_summary"
        df = pd.DataFrame((result.get("summary") or {}).get("records") or [])
    else:
        artifact = "stress_matrix"
        df = pd.DataFrame(result.get("cells") or [])
    target = _target_dir(job["deal"], body.get("folder"))
    path = target / _filename(job["kind"], artifact, fmt)
    if fmt == "csv":
        df.to_csv(path, index=False)
    elif fmt == "json":
        path.write_text(json.dumps(clean(result), indent=1))
    elif fmt == "xlsx":
        df.to_excel(path, index=False)
    else:
        raise HTTPException(status_code=422, detail=f"format must be one of {FORMATS}")
    return {"path": str(path), "filename": path.name}


@router.get("/deals/{slug}/exports")
def list_deal_exports(slug: str) -> list[dict[str, Any]]:
    folder = config.EXPORT_DIR / slug
    if not folder.is_dir():
        return []
    rows = []
    for path in sorted(folder.iterdir(), reverse=True):
        if not path.is_file():
            continue
        stat = path.stat()
        rows.append({
            "filename": path.name,
            "path": str(path),
            "size": stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
        })
    return rows
