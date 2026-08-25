"""
ccflows-ui/backend/api/deals.py
Deal CRUD over the JSON workspace folder + base-JSON download/upload.
"""

import copy
import json
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query, Request
from fastapi.responses import FileResponse

from core import workspace
from core.document import DocumentError, new_deal, slugify

router = APIRouter()


@router.get("/deals")
def get_deals() -> list[dict[str, Any]]:
    return workspace.list_deals()


@router.post("/deals", status_code=201)
def create_deal(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Body is either {"name": ...} for a starter template, or a full document."""
    if set(body.keys()) <= {"name"}:
        name = body.get("name") or ""
        doc = new_deal(name)
    else:
        doc = body
        if "meta" not in doc or not doc["meta"].get("name"):
            raise DocumentError("meta.name is required", ["meta", "name"])
    slug = slugify(doc["meta"]["name"])
    if workspace.exists(slug):
        raise HTTPException(status_code=409, detail=f"Deal '{slug}' already exists")
    return workspace.save(doc)


@router.get("/deals/{slug}")
def get_deal(slug: str) -> dict[str, Any]:
    return workspace.load(slug)


@router.put("/deals/{slug}")
def put_deal(slug: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    if not workspace.exists(slug):
        raise HTTPException(status_code=404, detail=f"Deal '{slug}' not found")
    new_slug = slugify(body.get("meta", {}).get("name", slug))
    if new_slug != slug and workspace.exists(new_slug):
        raise HTTPException(status_code=409, detail=f"Deal '{new_slug}' already exists")
    saved = workspace.save(body)
    if new_slug != slug:
        workspace.delete(slug)  # rename: new file written above, drop the old one
    return saved


@router.delete("/deals/{slug}", status_code=204)
def delete_deal(slug: str) -> None:
    workspace.delete(slug)


@router.post("/deals/{slug}/duplicate", status_code=201)
def duplicate_deal(slug: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    doc = copy.deepcopy(workspace.load(slug))
    name = body.get("name")
    if not name:
        raise DocumentError("name is required", ["name"])
    if workspace.exists(slugify(name)):
        raise HTTPException(status_code=409, detail=f"Deal '{slugify(name)}' already exists")
    doc["meta"]["name"] = name
    doc["meta"].pop("created", None)
    return workspace.save(doc)


@router.get("/deals/{slug}/download")
def download_deal(slug: str) -> FileResponse:
    path = workspace.raw_path(slug)
    return FileResponse(path, media_type="application/json",
                        filename=f"{slug}.deal.json")


@router.post("/deals/import-config", status_code=201)
def import_config(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Import an existing ccflows config tree (.run.json/.yaml, .repline.*)
    by server-side path. Replines arrive fully resolved (curves + stress +
    portfolio overrides applied); run configs carry no waterfall, so the deal
    gets the starter A/B/R structure to edit."""
    from pathlib import Path

    from cashflows import load as engine_load
    from cashflows.serialize.recipe import repline_to_dict

    path = Path(str(body.get("path") or "")).expanduser()
    if not path.is_file():
        raise HTTPException(status_code=422, detail=f"No such file: {path}")
    try:
        run_config = engine_load(path)
        replines = run_config.get_replines()
    except (ValueError, KeyError, FileNotFoundError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=f"Config load failed: {exc}") from exc

    name = str(body.get("name") or run_config.name or path.stem)
    doc = new_deal(name)
    doc["run"]["replines"] = [{"inline": repline_to_dict(r)} for r in replines]
    dollars = getattr(run_config.originations, "dollar_originations", None)
    if dollars is not None and len(dollars) > 0:
        doc["run"]["originations"] = {"schedule": [float(x) for x in dollars]}
    doc["meta"]["tags"] = list(getattr(run_config, "tags", []) or [])
    provenance = f"Imported from {path}"
    if run_config.description:
        provenance = f"{run_config.description}\n{provenance}"
    doc["meta"]["notes"] = (provenance + "\nRun configs carry no waterfall — "
                            "the starter A/B/R structure was applied; edit it "
                            "on the STRUCTURE tab.")
    slug = slugify(name)
    if workspace.exists(slug) and not body.get("overwrite"):
        raise HTTPException(status_code=409,
                            detail=f"Deal '{slug}' already exists (pass overwrite)")
    return workspace.save(doc)


@router.post("/deals/import", status_code=201)
async def import_deal(request: Request, overwrite: bool = Query(False)) -> dict[str, Any]:
    """Upload a base JSON (raw JSON body). Validates structure; engine-level
    problems are surfaced by /validate endpoints, not blocked here — drafts
    are legitimate documents."""
    try:
        doc = json.loads(await request.body())
    except json.JSONDecodeError as exc:
        raise DocumentError(f"Not valid JSON: {exc}") from exc
    if not isinstance(doc, dict) or not doc.get("meta", {}).get("name"):
        raise DocumentError("meta.name is required", ["meta", "name"])
    slug = slugify(doc["meta"]["name"])
    if workspace.exists(slug) and not overwrite:
        raise HTTPException(status_code=409,
                            detail=f"Deal '{slug}' already exists (use ?overwrite=true)")
    return workspace.save(doc)
