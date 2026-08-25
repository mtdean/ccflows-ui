"""
ccflows-ui/backend/api/artifacts.py
Saved-run artifacts and the month-end close lifecycle:

  scenario runs   POST/GET/DELETE /deals/{slug}/scenario-runs[...]
  book closes     POST/GET /book-closes, POST .../approve, DELETE
  load sources    GET /deals/{slug}/sources, POST /deals/{slug}/load-source

A book close is the FM package: every held deal's base-case run + the marks
in force (with the marking rationale notes) + each fund's frozen analytics.
FM approval flips it to `fm_approved`, forces engine closes on tracked deals,
and becomes the portfolio view's good-through anchor.
"""

from typing import Any

from fastapi import APIRouter, Body, HTTPException

from core import artifact_store, workspace
from core.artifact_store import ArtifactError
from core.document import check_structure, DocumentError
from core.serialization import clean

router = APIRouter()


# --- Scenario runs ----------------------------------------------------------

@router.post("/deals/{slug}/scenario-runs", status_code=201)
def save_scenario_run(slug: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """{name, doc?, scenario?, custom_multipliers?, macro_scenario?, price?,
    notes?} — runs the engine and freezes doc + metrics under the name.
    Without a doc, the saved deal is used."""
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Scenario name is required")
    doc = body.get("doc") or workspace.load(slug)
    try:
        artifact = artifact_store.save_scenario(
            slug, name, doc,
            scenario=str(body.get("scenario") or "base"),
            custom_multipliers=body.get("custom_multipliers"),
            macro_scenario=body.get("macro_scenario"),
            price=float(body.get("price") or 100.0),
            notes=str(body.get("notes") or ""))
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {k: artifact[k] for k in ("name", "slug", "saved_at", "stress", "metrics",
                                     "boundary_month", "warnings")}


@router.get("/deals/{slug}/scenario-runs")
def list_scenario_runs(slug: str) -> dict[str, Any]:
    return clean({"scenarios": artifact_store.list_scenarios(slug)})


@router.get("/deals/{slug}/scenario-runs/{scenario_slug}")
def get_scenario_run(slug: str, scenario_slug: str) -> dict[str, Any]:
    try:
        return clean(artifact_store.load_scenario(slug, scenario_slug))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/deals/{slug}/scenario-runs/{scenario_slug}", status_code=204)
def delete_scenario_run(slug: str, scenario_slug: str) -> None:
    artifact_store.delete_scenario(slug, scenario_slug)


# --- Book closes ------------------------------------------------------------

@router.post("/book-closes", status_code=201)
def create_book_close(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """{month?: YYYY-MM, notes?, overwrite?} -> the assembled close package."""
    try:
        artifact = artifact_store.build_book_close(
            month=body.get("month"), notes=str(body.get("notes") or ""),
            overwrite=bool(body.get("overwrite")))
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ArtifactError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return clean(_summary_of(artifact))


@router.get("/book-closes")
def get_book_closes() -> dict[str, Any]:
    """The close timeline with assumption-change flags vs the prior close."""
    return clean({"closes": artifact_store.list_book_closes()})


@router.get("/book-closes/{month}")
def get_book_close(month: str) -> dict[str, Any]:
    try:
        return clean(artifact_store.load_book_close(month))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ArtifactError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/book-closes/{month}/approve")
def approve_book_close(month: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """FM sign-off: {approver?, notes?} — flips to fm_approved and forces
    engine closes for every tracked deal in the package."""
    try:
        artifact = artifact_store.approve_book_close(
            month, approver=str(body.get("approver") or "FM"),
            notes=str(body.get("notes") or ""))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ArtifactError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return clean({**_summary_of(artifact),
                  "engine_closes": artifact.get("engine_closes")})


@router.delete("/book-closes/{month}", status_code=204)
def delete_book_close(month: str, force: bool = False) -> None:
    try:
        artifact_store.delete_book_close(month, force=force)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ArtifactError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _summary_of(artifact: dict[str, Any]) -> dict[str, Any]:
    return {
        "month": artifact["month"], "status": artifact["status"],
        "created_at": artifact.get("created_at"),
        "approved_at": artifact.get("approved_at"),
        "approved_by": artifact.get("approved_by"),
        "n_deals": len(artifact.get("deals") or {}),
        "skipped": artifact.get("skipped") or {},
    }


# --- Load-month sources -----------------------------------------------------

@router.get("/deals/{slug}/sources")
def get_deal_sources(slug: str) -> dict[str, Any]:
    """Everything a new modeling month can start from: named scenarios and the
    book closes (ABF or FM-approved) that carry this deal."""
    closes = []
    for row in artifact_store.list_book_closes():
        try:
            artifact = artifact_store.load_book_close(row["month"])
        except (FileNotFoundError, ArtifactError):
            continue
        if slug in (artifact.get("deals") or {}):
            closes.append({"month": row["month"], "status": row["status"],
                           "approved_at": row.get("approved_at"),
                           "created_at": row.get("created_at")})
    return clean({
        "scenarios": artifact_store.list_scenarios(slug),
        "book_closes": sorted(closes, key=lambda c: c["month"], reverse=True),
    })


@router.post("/deals/{slug}/load-source")
def load_deal_source(slug: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """{kind: "scenario"|"book_close", ref} -> the frozen deal doc to start the
    new month from (the client drops it into the draft; nothing is saved)."""
    kind = str(body.get("kind") or "")
    ref = str(body.get("ref") or "")
    if kind == "scenario":
        try:
            artifact = artifact_store.load_scenario(slug, ref)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        doc, origin = artifact.get("doc"), f"scenario '{artifact.get('name')}'"
    elif kind == "book_close":
        try:
            artifact = artifact_store.load_book_close(ref)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ArtifactError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        deal = (artifact.get("deals") or {}).get(slug)
        if not deal:
            raise HTTPException(status_code=404,
                                detail=f"Book close {ref} does not carry deal '{slug}'")
        status = "FM-approved" if artifact.get("status") == "fm_approved" else "ABF"
        doc, origin = deal.get("doc"), f"{status} close {artifact.get('month')}"
    else:
        raise HTTPException(status_code=422, detail="kind must be scenario or book_close")
    try:
        check_structure(doc)
    except DocumentError as exc:
        raise HTTPException(status_code=422,
                            detail=f"Frozen doc is not loadable: {exc}") from exc
    return clean({"doc": doc, "origin": origin})
