# 01 — Architecture

## Stack and why

- **Backend**: FastAPI + uvicorn, one process, port **8020** (`CCFLOWS_PORT`;
  8000 was taken by another local tool on the original machine). Python venv
  at `backend/.venv` with the engine installed editable from a **sibling
  checkout**: `-e ../../ccflows[excel]` — the two repos must sit next to each
  other (`<parent>/ccflows` + `<parent>/ccflows-ui`).
- **Frontend**: React 19 + Vite + TypeScript, React Query for all server
  state, Recharts for charts, dnd-kit for waterfall step reordering, mermaid
  (lazy-loaded, ~1.5MB) for the flow diagram, papaparse for CSV. Built to
  `frontend/dist` and served by the same FastAPI process — one port, no CORS
  in production use (CORS is open for dev-mode hot reload).
- **No database.** Persistence is JSON files in `workspace/` (see below).
  This is deliberate: deals are documents the user emails, diffs, and
  hand-edits; a DB would hide them.

## Run

- `scripts/run.sh` (macOS/Linux) or `scripts/run.ps1` (Windows). Both create
  the venv on first run. Dev mode: uvicorn `--reload` + `npm run dev`
  (vite proxies `/api` to 8020).
- Startup (`main.py` lifespan): `config.ensure_dirs()` builds the folder
  skeleton, then the Pensford crawler daemon starts
  (`CCFLOWS_PENSFORD_AUTO=0` disables — tests do this).

## Folder skeleton (startup-built, self-healing via /api/health)

```
workspace/                    {slug}.deal.json        ccflows-ui.deal/1
                              {slug}.portfolio.json   ccflows-ui.portfolio/1
                              {slug}.rates.json       ccflows-ui.rates/1
                              {slug}.curveslib.json   ccflows-ui.curves/1
                              marks.json              ccflows-ui.markbook/1
  scenarios/{deal}/{name}.json  ccflows-ui.scenario-run/1
  book_closes/{YYYY-MM}.json    ccflows-ui.bookclose/1
  closes/                       engine CloseStore (per-deal month closes)
exports/{deal}/{YYYYMMDD}_{HHMMSS}_{scenario}_{artifact}.{ext}
```

`workspace/` and `exports/` are **gitignored** — the repo holds code, not the
book. Back the workspace folder up separately.

All writes are atomic (`tmp` + `os.replace`) behind per-store locks.

## Backend module map

- `core/document.py` — deal doc schema, structural validation, list summary.
- `core/workspace.py` / `portfolio_store.py` / `rates_store.py` /
  `mark_book.py` / `artifact_store.py` — one store per JSON family.
- `core/engine_bridge.py` — the ONLY module that drives the engine deeply
  (doc → replines → models → waterfall → result; stress; splice; calls;
  reinvestment; CGL policy). Everything else goes through it.
- `core/tracking.py` — content-hash-cached engine `TrackedDeal` per deal
  (monitoring, P&L, covenants, drift). Cache key covers run/waterfall/rates/
  actuals/covenants sections.
- `core/results_store.py` — in-memory LRU of run results (numpy-heavy,
  regenerable; eviction → HTTP 410 → the UI re-runs).
- `core/jobs.py` — bounded ThreadPoolExecutor for MC/sensitivities/matrices.
- `core/treasury.py`, `core/takeout.py`, `core/pensford_crawler.py` — see
  the dedicated files in this folder.
- `api/*.py` — thin routers; every endpoint returns JSON-clean payloads via
  `core/serialization.clean` (numpy → native, NaN/inf → null).

## Deliberate non-features

- No auth. This is a desk tool; anyone who can reach the port can do
  anything (including FM-approving closes). Add a token before multi-user
  LAN use if that matters.
- No migrations. Schema tags (`ccflows-ui.*/1`) exist so future versions can
  translate on read; today, version 1 everywhere.
