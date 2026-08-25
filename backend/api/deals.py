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


def _template_base(name: str, notes: str) -> dict[str, Any]:
    doc = new_deal(name)
    doc["meta"]["notes"] = notes
    doc["meta"]["tags"] = ["template"]
    return doc


AUTHORING_NOTES = (
    "AUTHORING NOTES — edit this file and upload it via the JSON button. "
    "Curve arrays (cdr, cpr, dq_*, ...) may be ANY length: the engine pads to the "
    "361-month horizon by repeating the last value, so [0.0017] means flat and "
    "[0.001, 0.002, 0.003] ramps then holds. All rates are decimals "
    "(0.0017 = 0.17%/month); monthly CDR/CPR ~= annual/12 for small rates. "
    "Bond size_pct are fractions of the pool and the residual takes the "
    "remainder; every waterfall needs exactly one residual, last. Delete the "
    "sections you don't need (stress/monte_carlo/covenants have working "
    "defaults). Validation runs on upload and flags problems by field."
)


def _compact_flat(value: float) -> list[float]:
    return [value]


TEMPLATE_BUILDERS: dict[str, dict[str, Any]] = {}


def _register_template(key: str, label: str, description: str, build) -> None:
    TEMPLATE_BUILDERS[key] = {"key": key, "label": label,
                              "description": description, "build": build}


def _amortizing_template() -> dict[str, Any]:
    doc = _template_base("My Amortizing Deal", AUTHORING_NOTES)
    doc["run"]["replines"][0]["inline"].update({
        "repline_id": "pool_1",
        "cdr": _compact_flat(0.02 / 12),
        "cpr": _compact_flat(0.10 / 12),
    })
    doc["run"]["replines"][0].pop("curve_specs", None)
    return doc


def _royalty_template() -> dict[str, Any]:
    doc = _template_base("My Royalty Deal", AUTHORING_NOTES + (
        " ROYALTY SPECIFICS: upb is the purchase price; royalty_income_curve is "
        "gross dollar receipts per month; royalty_seasonality is 12 monthly "
        "multipliers (mean-normalized); cdr/cpr stay zero."))
    doc["run"]["replines"] = [{
        "inline": {
            "repline_id": "catalog_1",
            "amortization_type": "royalty",
            "upb": 10_000_000.0,
            "term": 120,
            "cdr": [0.0], "cpr": [0.0],
            "royalty_income_curve": [150_000.0],
            "royalty_decay_rate": [0.008],
            "royalty_seasonality": [1.10, 0.95, 0.90, 0.95, 1.00, 1.00,
                                    0.95, 0.95, 1.00, 1.05, 1.10, 1.15],
            "payor_default_rate": [0.01],
            "recovery_rate": 0.50,
            "recovery_timing": 3,
        },
    }]
    return doc


def _clo_template() -> dict[str, Any]:
    from cashflows.liabilities import from_clo
    from cashflows.liabilities.spec import waterfall_to_dict
    from cashflows.securitization.tranches import CoverageTest, TrancheSpec

    doc = _template_base("My CLO", AUTHORING_NOTES + (
        " CLO SPECIFICS: floating collateral + floating tranches (margin over "
        "the index), per-class OC/IC coverage diversion steps, deferrable "
        "juniors. Enable a reinvestment window under the deal's 'reinvestment' "
        "section (the waterfall already carries the reinvest step)."))
    doc["run"]["replines"][0]["inline"].update({
        "repline_id": "loan_pool",
        "upb": 400_000_000.0,
        "gross_wac": 0.0925, "net_wac": 0.0895,
        "term": 72, "age": 6,
        "floating_rate": True,
        "cdr": _compact_flat(0.03 / 12),
        "cpr": _compact_flat(0.25 / 12),
        "recovery_rate": 0.65, "recovery_timing": 9,
    })
    doc["run"]["replines"][0].pop("curve_specs", None)
    wf = from_clo(
        [TrancheSpec("A", size_pct=0.62, margin=0.0145, floating=True),
         TrancheSpec("B", size_pct=0.12, margin=0.0210, floating=True),
         TrancheSpec("C", size_pct=0.08, margin=0.0325, floating=True, deferrable=True),
         TrancheSpec("R", is_residual=True)],
        coverage_tests=[CoverageTest(tranche="B", oc_trigger=1.18, ic_trigger=1.10)],
        senior_fee_bps=40.0, sub_fee_bps=30.0,
        servicing_fee=0.0015, reinvestment=True,
    )
    doc["waterfall"] = waterfall_to_dict(wf)
    doc["reinvestment"] = {"enabled": False, "reinvest_months": 24,
                           "template_repline_id": "loan_pool",
                           "purchase_price_pct": 100.0, "reinvest_share": 1.0,
                           "max_iterations": 5}
    return doc


def _forward_flow_template() -> dict[str, Any]:
    from cashflows.liabilities import warehouse_waterfall
    from cashflows.liabilities.spec import waterfall_to_dict

    doc = _template_base("My Forward Flow", AUTHORING_NOTES + (
        " FORWARD-FLOW SPECIFICS: replines are vintage TEMPLATES (upb = unit "
        "face, distribution = mix weight); run.originations.schedule is monthly "
        "purchase dollars; the warehouse waterfall draws against purchases, "
        "revolves collections, then amortizes."))
    doc["run"]["replines"] = [{
        "inline": {
            "repline_id": "prime", "amortization_type": "simple",
            "upb": 1_000_000.0, "gross_wac": 0.14, "net_wac": 0.125,
            "term": 48, "distribution": 0.6,
            "cdr": [0.02 / 12], "cpr": [0.12 / 12],
            "recovery_rate": 0.40, "recovery_timing": 6,
        },
    }, {
        "inline": {
            "repline_id": "near_prime", "amortization_type": "simple",
            "upb": 1_000_000.0, "gross_wac": 0.19, "net_wac": 0.17,
            "term": 36, "distribution": 0.4,
            "cdr": [0.05 / 12], "cpr": [0.10 / 12],
            "recovery_rate": 0.35, "recovery_timing": 6,
        },
    }]
    doc["run"]["originations"] = {"schedule": [2e6, 3e6, 4e6] + [5e6] * 9 + [3e6] * 12}
    doc["waterfall"] = waterfall_to_dict(warehouse_waterfall(
        credit_line=60_000_000.0, advance_rate=0.85,
        draw_months=11, recycle_months=23,
        senior_margin=0.0275, servicing_fee=0.0015))
    return doc


_register_template("amortizing", "Amortizing A/B/R",
                   "Auto/consumer style pool, two notes + residual, CNL turbo trigger.",
                   _amortizing_template)
_register_template("royalty", "Royalty stream",
                   "Decaying, seasonal dollar-receipt stream with payor default risk.",
                   _royalty_template)
_register_template("clo", "CLO with coverage tests",
                   "Floating stack, OC/IC diversion, fees, optional reinvestment window.",
                   _clo_template)
_register_template("forward-flow", "Forward flow + warehouse",
                   "Origination ramp builds the pool; draw/revolve/amortize facility.",
                   _forward_flow_template)


@router.post("/deals/{slug}/securitize", status_code=201)
def securitize(slug: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Securitization takeout: season this deal's collateral to month k, create
    a term deal from it, optionally set the takeout call on this deal and roll
    a fund's positions.

    body: {month, name, structure: "abr"|"abcr"|"abcder"|"copy",
           takeout_price_pct?, set_call?, doc?,
           roll_fund?: {portfolio, retire_warehouse?, add_positions?: [...]}}
    """
    from core import takeout

    doc = body.get("doc") or workspace.load(slug)
    k = int(body.get("month") or 0)
    name = str(body.get("name") or f"{doc['meta']['name']} Takeout")
    structure = str(body.get("structure") or "abr")
    price_pct = float(body.get("takeout_price_pct") or 100.0)

    try:
        entries, info = takeout.season_replines(doc, k)
        waterfall = takeout.term_waterfall(structure, doc)
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    term = new_deal(name)
    term["run"]["run_date"] = takeout.takeout_run_date(info["run_date"], k)
    term["run"]["replines"] = entries
    term["waterfall"] = waterfall
    term["rates"] = doc.get("rates") or term["rates"]
    term["meta"]["tags"] = ["takeout"]
    term["meta"]["notes"] = (
        f"Takeout of '{doc['meta']['name']}' at month {k} "
        f"(seasoned from {info['source']}; pool {info['balance']:,.0f}; "
        f"takeout price {price_pct:g}). Curves re-anchored to the boundary.")
    term_slug = slugify(name)
    if workspace.exists(term_slug) and not body.get("overwrite"):
        raise HTTPException(status_code=409,
                            detail=f"Deal '{term_slug}' already exists (pass overwrite)")
    saved_term = workspace.save(term)

    changed: dict[str, Any] = {"term_deal": term_slug,
                               "seasoned_balance": info["balance"],
                               "seasoned_from": info["source"]}

    if body.get("set_call", True):
        warehouse = workspace.load(slug)
        warehouse["call"] = {"enabled": True, "call_month": k, "nc_months": 0,
                             "call_price_pct": price_pct, "clean_up_call": False,
                             "clean_up_call_pct": 0.10}
        workspace.save(warehouse)
        changed["warehouse_call"] = {"call_month": k, "call_price_pct": price_pct}

    roll = body.get("roll_fund") or {}
    if roll.get("portfolio"):
        from core import portfolio_store

        pf = portfolio_store.load(str(roll["portfolio"]))
        # default: KEEP warehouse positions — the call truncates their cashflows
        # at month k, so they self-terminate with the payoff in the ledger;
        # removing them would erase the proceeds from the fund's cash history
        if roll.get("retire_warehouse", False):
            before = len(pf["positions"])
            pf["positions"] = [p for p in pf["positions"] if p.get("deal") != slug]
            changed["retired_positions"] = before - len(pf["positions"])
        added = 0
        for p in roll.get("add_positions") or []:
            pf["positions"].append({
                "deal": term_slug, "tranche": str(p.get("tranche") or "R"),
                "face": float(p.get("face") or 0.0),
                "cost_basis": float(p.get("cost_basis") or 100.0),
                "acquired_month": 0,
            })
            added += 1
        changed["added_positions"] = added
        portfolio_store.save(pf)
        changed["portfolio"] = roll["portfolio"]

    return {"term_deal": saved_term, "changes": changed}


@router.get("/deal-templates")
def list_templates() -> list[dict[str, Any]]:
    return [{k: t[k] for k in ("key", "label", "description")}
            for t in TEMPLATE_BUILDERS.values()]


@router.get("/deal-templates/{key}")
def get_template(key: str) -> dict[str, Any]:
    template = TEMPLATE_BUILDERS.get(key)
    if template is None:
        raise HTTPException(status_code=404, detail=f"No template {key!r}")
    return template["build"]()


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
