# 08 — Testing and verification

## Backend suite (`backend/tests/`, 102 tests, ~6s)

- `conftest.py` points `CCFLOWS_WORKSPACE` / `CCFLOWS_EXPORTS` at a temp dir
  BEFORE importing `config`, sets `CCFLOWS_PENSFORD_AUTO=0` (the suite must
  never touch the network — Pensford tests monkeypatch `fetch_pensford_df`),
  and exposes a session-scoped FastAPI `TestClient`.
- One file per domain: schema, deals, validate, runs, jobs, exports,
  analysis, monitor, lifecycle, portfolios, actuals_demos, infrastructure,
  cgl_policy, artifacts, pensford_crawler, health.
- Run: `backend/.venv/bin/python -m pytest tests/ -q`.

## The verification bar: identities, not smoke tests

Every engine integration asserts a FINANCIAL IDENTITY the feature must
satisfy, because plausible-looking numbers are the failure mode here:

- price a tranche at its own coupon → 100;
- stress ordering: severe ≤ moderate ≤ base on residual XIRR;
- Monte Carlo deterministic by seed;
- P&L `tie_check` = 0; portfolio P&L ties to (price−cost)/100 × face ×
  factor; fund P&L begin/end MV chain across buckets;
- treasury: closing = opening + net every row; interest starts the month
  AFTER a draw; clips are noted;
- takeout: `term.cdr[0] == warehouse.cdr[k]` (curve re-anchoring);
- CGL: default roll lifetime = realized + planned-remaining; hold-constant
  lifetime = exactly CGL × face (both under- and over-run tapes);
- commitments: dry_powder_net = dry_powder − Σ unfunded;
- self-splice: a tape generated from the model's own months reproduces the
  original run (the fixture trick for forward what-ifs).

When you add a feature, find its identity and pin it.

## Browser verification (manual gate before every push)

Playwright-core (npm) driving the system Chrome binary, headless — scripts
live in the session scratchpad, not the repo (they're disposable):

```js
import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true });
// collect console errors + pageerrors; drive; screenshot; assert none.
```

The bar: drive every changed page to a rendered state, capture screenshots,
**zero console errors / page errors**. Dialogs (prompt/confirm) are handled
with `page.on('dialog', ...)`. Screenshots that document features go to
`docs/screenshots/` and the README.

## Working agreements

- `npx tsc --noEmit` and `npm run build` must be clean before commit.
- Server restart pattern: kill port 8020, `nohup .venv/bin/python main.py`,
  curl `/api/health`.
- Never point tests or dev servers at the real `workspace/` — env vars exist
  precisely so the user's book can't be touched by a test run.
- Commits: one feature-set per commit with a body that states WHAT and WHY;
  push to `origin main` after the suite + build + browser pass.
