"""
ccflows-ui/backend/api/routes.py
Top-level /api router: aggregates the domain routers.
"""

from fastapi import APIRouter

from . import (actuals, analysis, artifacts, curves_libs, deals, exports, jobs,
               marks_book, monitor, portfolios, rates_curves, runs, schema,
               validate, workspaces)

router = APIRouter()


@router.get("/health")
def health() -> dict:
    import cashflows
    import config

    config.ensure_dirs()  # self-heal: rebuild any missing piece of the skeleton
    return {"status": "ok", "engine": "cashflows",
            "engine_version": cashflows.__version__,
            "dirs": config.dirs_status()}


router.include_router(schema.router)
router.include_router(deals.router)
router.include_router(jobs.router)
router.include_router(validate.router)
router.include_router(runs.router)
router.include_router(exports.router)
router.include_router(analysis.router)
router.include_router(portfolios.router)
router.include_router(actuals.router)
router.include_router(monitor.router)
router.include_router(rates_curves.router)
router.include_router(curves_libs.router)
router.include_router(marks_book.router)
router.include_router(artifacts.router)
router.include_router(workspaces.router)
