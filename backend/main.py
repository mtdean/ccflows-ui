"""
ccflows-ui/backend/main.py
FastAPI application — serves the deal-builder API and the built React frontend
on one port. Run: .venv/bin/python main.py  (or uvicorn main:app --reload for dev)
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import config
from api.errors import register_exception_handlers
from api.routes import router
from core.jobs import shutdown_executor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_dirs()
    import cashflows

    logger.info("ccflows-ui up — engine cashflows %s", cashflows.__version__)
    yield
    shutdown_executor()


app = FastAPI(title="<CCFLOWS>", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # local/LAN tool; restrict if ever exposed externally
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)
app.include_router(router, prefix="/api")

# Serve the built React frontend (frontend/dist) from this same server so the
# whole app is reachable on one port. Build first: `cd frontend && npm run build`.
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if FRONTEND_DIST.is_dir():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve a real static file if it exists, else the SPA index (client routing)."""
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (FRONTEND_DIST / full_path).resolve()
        if full_path and candidate.is_file() and FRONTEND_DIST in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
else:
    logger.warning("Frontend dist/ not found — run `npm run build` in frontend/")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=config.PORT, reload=False)
