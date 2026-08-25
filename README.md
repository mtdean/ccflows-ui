# ccflows-ui

A full web front-end for the [`cashflows`](../ccflows) structured-finance engine:
build collateral pools from **repline cards**, structure liabilities as a **bond
stack + ordered payment waterfall** (tests and triggers included), load
**remittance actuals**, run **base / stress / Monte Carlo** scenarios, monitor
deals (**covenants, surveillance, redline, P&L, monthly close**), price and
analyze everything, and roll positions up into **per-fund portfolios** with
live marks and IRRs. Everything a deal is lives in one base JSON.

Dark-terminal design language (IBM Plex Mono, sharp panels, no spinners),
borrowed from situation-monitor.

---

## Running it

### First-time setup

```bash
# 1. Frontend build (Node 18+)
cd frontend
npm install
npm run build
cd ..

# 2. Backend venv (Python 3.12+; engine installed editable from ../ccflows)
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cd ..

# 3. (optional) seed the three demo deals
backend/.venv/bin/python backend/scripts/make_demos.py
```

### Start

```bash
./scripts/run.sh          # -> http://localhost:8020
```

One FastAPI process serves both the API (`/api/*`) and the built SPA. The port
is `CCFLOWS_PORT` (default **8020**). LAN access works out of the box (the
script prints your LAN URL).

### Windows

The app is fully portable; only the launch script differs. Check out the
**`ccflows` engine as a sibling** of this repo (the backend installs it from
`..\..\ccflows`), then in PowerShell:

```powershell
# layout:  <parent>\ccflows  and  <parent>\ccflows-ui
cd ccflows-ui\frontend
npm install; npm run build
cd ..
.\scripts\run.ps1          # creates backend\.venv on first run -> http://localhost:8020
```

Notes: Python 3.12+ and Node 18+ on PATH; venv binaries live under
`.venv\Scripts\` (not `.venv/bin/`); `run.sh` also works under WSL or Git
Bash if you prefer. Tests: `backend\.venv\Scripts\python -m pytest -q`.

### Development mode (hot reload)

```bash
# terminal 1 — backend with reload
cd backend && .venv/bin/uvicorn main:app --port 8020 --reload

# terminal 2 — frontend dev server (proxies /api to :8020)
cd frontend && npm run dev        # -> http://localhost:5173
```

### Tests

```bash
cd backend && .venv/bin/python -m pytest -q     # ~65+ tests, a few seconds
```

### Environment knobs

| Variable | Default | Meaning |
|---|---|---|
| `CCFLOWS_PORT` | `8020` | Server port |
| `CCFLOWS_WORKSPACE` | `./workspace` | Deal + portfolio JSONs, closes |
| `CCFLOWS_EXPORTS` | `./exports` | Export target root |
| `CCFLOWS_JOB_WORKERS` | `2` | Background-job thread pool size |
| `CCFLOWS_RESULTS_CACHE` | `20` | In-memory run-result LRU size |

---

## The tour

### Deal folders (workspaces)

Each *book* is one folder of JSON (deals, tapes, portfolios, marks, closes,
scenarios, rate curves). The **folder switcher** in the top bar lists known
books and repoints the whole app in place — subfolders are created
automatically, engine caches flush, and nothing crosses between books. Add
as many folders as you like; the registry lives in
`~/.ccflows-ui/workspaces.json`. Setting `CCFLOWS_WORKSPACE` pins the folder
from the environment and disables in-app switching (tests use this).

![Workspace switcher](docs/screenshots/52-workspace-menu.png)

### Deals are one JSON

Every deal is a single document (`workspace/{slug}.deal.json`): replines,
waterfall, rates, actuals tapes, stress/MC settings, covenants, call and
reinvestment config. The **⬇ JSON / ⬆ JSON** buttons in the top bar download
and re-upload that exact file — it's the save format, the share format, and
the archive format at once. Engine-native sections round-trip through
`cashflows`' own codecs. The **TEMPLATES ▾** menu on the Deals page downloads
hand-editable starter JSONs (amortizing A/B/R, royalty, CLO, forward-flow) —
curve arrays may be any length (the engine pads by repeating the last value),
and authoring notes ride in `meta.notes`.

### Rates, curve libraries, and config import

An **embedded Pensford crawler** keeps the `pensford-sofr` workspace curve
fresh: a background daemon fetches the live SOFR forward table daily (1M/3M
Term, 1M ISDA, 30D NYFED average, daily SOFR, Prime — monthly, decimals) and
the RATE CURVES panel shows a freshness chip + FETCH NOW. Disable with
`CCFLOWS_PENSFORD_AUTO=0`; cadence via `CCFLOWS_PENSFORD_INTERVAL_HOURS`.
Point any deal at it with rates mode NAMED CURVE.

Workspace-level **RATE CURVES** (Deals page): build named curves from a flat
rate, month-offset points (linear interp), a **live Pensford SOFR forward
fetch**, or a CSV upload (`date` + decimal rate columns — a Bloomberg export
drops straight in). Deals reference a curve + index column via the RATES panel
(multi-index curves supported). **CURVE LIBRARIES** promote any repline's
assumption set into a reusable library ("SAVE CURVES AS LIBRARY" on the card)
and apply it to other replines — only the curves the library explicitly
carries are touched. **IMPORT CONFIG** loads existing ccflows `.run.json`
config trees by path, with curves, stress, and portfolio overrides fully
resolved.

### COLLATERAL — repline cards

Each repline card shows the minimal fields; **[+ ADD FIELD]** opens a searchable
menu of every other engine knob, generated from the engine's field registry
(all 8 collateral engines: amortizing, promo, card, lease, MCA, factoring,
student loan, royalty). Curves are edited as flat/ramp/vector/Excel-paste
recipes with live preview. A **FORWARD FLOW** panel turns the pool into a
vintage build-up along a monthly origination schedule.

![Collateral](docs/screenshots/02-collateral.png)
![Curve editor](docs/screenshots/04-curve-editor.png)
![Forward flow](docs/screenshots/21-forward-flow-clean.png)

### STRUCTURE — bond chart + waterfall

Seniority-ordered bond stack (size % or balance, fixed/float, PIK) with preset
structures (**A/B/R, A/B/C/R, A/B/C/D/E/R, CLO, facility**); the payment
waterfall is a drag-to-reorder step list (19 step types) with a live flow
diagram rendered from the engine's own `to_mermaid()`. Tests & triggers
(CNL/OC/IC/…, stepped schedules, cure policies) attach to steps by name. A
**CALL & REINVESTMENT** panel adds call mechanics (non-call period, clean-up
call) and a revolving reinvestment window.

![Structure](docs/screenshots/05-structure.png)
![CLO structure](docs/screenshots/18-clo-structure.png)

### ACTUALS — remittance tapes

Upload servicer (collateral) and trustee (bond) CSVs — templates downloadable
in-app, validated against the engine's schema. Monthly files **append** to the
existing tape (overlapping months replace after a confirmation). Every run
**splices the tape
ahead of projections**, re-anchoring assumption curves at the boundary.
Actual-vs-projected **CDR/CPR charts** and a **redline backtest** (variance,
tracking error, hit rate) come free.

![Actual vs projected](docs/screenshots/28-actuals-performance.png)

### CGL + loss timing, and the roll policy

Repline losses are one choice on the card: a **CDR vector**, or **CGL +
loss timing** — a lifetime cumulative gross loss (% of face) spread over a
timing curve (the stored curve sums to CGL; edit either side and the other
follows). Deals on a CGL framework get a **CGL ROLL POLICY** panel on
ACTUALS: the engine's default roll keeps the *original forward loss
schedule* (an actuals under-run permanently lowers lifetime losses);
flipping a repline to **hold CGL constant** rescales the remaining loss
curve on every roll so lifetime losses stay pinned at CGL × face given
whatever the tape realized. The applied forward factor is shown in the
panel and in run warnings, and updates as new months load.

![CGL loss input](docs/screenshots/43-cgl-loss-input.png)
![CGL roll policy](docs/screenshots/44-cgl-roll-policy.png)

### MONITOR — the surveillance workstation

Status board (per-bond performing/shortfall/off-model), **covenants**
(declarative factories — max CNL, charge-off rate, DQ ratio, excess spread,
OC/IC, pool factor — with grace/cure state machines and breach charts),
**surveillance rules** (CDR/CPR vs assumed, DQ trends, collections variance),
spliced per-tranche series, **fair-value P&L roll-forwards** (tie-checked to
zero, IRR-to-date), and a **monthly close** with input fingerprints, amendment
trails, and drift checks.

![Monitor status](docs/screenshots/24-monitor-status.png)
![Covenants](docs/screenshots/25-monitor-covenants.png)
![Spliced tranches](docs/screenshots/26-monitor-tranches.png)
![P&L](docs/screenshots/27-monitor-pnl.png)

### SCENARIOS + RESULTS

Named stress chips (mild → recession), custom curve multipliers, a CDR××CPR×
stress matrix, collateral Monte Carlo (VaR/ES, fan charts) and **tranche-level
Monte Carlo** — the same waterfall run over every sampled collateral path, so
you get bond XIRR/writedown distributions and residual-cash percentiles.
Results: stack summary with delta-vs-base, tranche balance charts, monthly
ledgers, trigger timelines, and the month-by-month `explain()` cash walk.

![Scenarios](docs/screenshots/06-scenarios.png)
![Stack](docs/screenshots/07-results-stack.png)
![Tranche MC](docs/screenshots/30-tranche-mc.png)

### ANALYSIS — pricing and valuation

Tranche pricing at a manual yield, DM, spread, or **your own zero/swap curve**;
yield & price tables; per-repline **unit economics** and whole-loan pricing;
**principal breakevens** (loss multiplier to impairment per tranche);
**residual solver** (target residual yield ⇄ max collateral price); full-deal
marks; **sensitivities** — CDR/CPR/rate/macro sweeps with a tornado chart,
effective duration, and DV01; and **WHAT-IF** — "performs to plan through
month k, then a macro scenario hits," with carries, reserve, and trigger
clocks seeded from the boundary.

![Tranche pricing](docs/screenshots/12-analysis-pricing.png)
![Breakevens](docs/screenshots/13-analysis-breakevens.png)
![Residual solver](docs/screenshots/22-residual-solver.png)
![Tornado](docs/screenshots/29-sensitivities-tornado.png)

### Fund treasury & cash

Each fund carries a **TREASURY & CASH** ledger: opening cash, a credit line
(limit + rate), and dated capital events (contributions, distributions, draws,
repayments). Deal receipts land on the **calendar** — each deal's month m maps
through its run date — so the fund sees one Excel-shaped monthly grid: opening
cash, capital flows, credit activity and interest (accruing on the balance
carried into the month), position purchases, deal receipts (actuals through
each tape's boundary, projections after, marked ᵖ), closing cash, drawn
balance, and **dry powder** (cash + undrawn capacity), with a chart on top.
A **FUND P&L** toggle aggregates the engine's per-position fair-value
statements (cost basis, face, acquisition month, mark-book schedules) onto
the same calendar by month/quarter/year.

### The mark book

One shared **MARK BOOK** (Portfolios page) holds a mark per (deal, tranche)
across all funds — method (spread/DM/yield) plus a **stepped schedule**
("200, 250 @m8" = 200bp until month 8, then 250). Funds resolve marks as:
per-position override → mark book (at the deal's actuals boundary) → fund
default, with a badge showing the source. **IMPORT MARKS** pastes a pricing
run (`deal, tranche, value [, month] [, method]` per line) across the whole
book, and P&L statements can run off the book's schedules
(MONITOR → P&L → USE MARK BOOK).

### PORTFOLIOS — per-fund books

One portfolio per fund; positions are deal + tranche + face + cost basis.
Opening a fund auto-reruns stale deals; deals with actuals are marked **at the
splice boundary**. Each position shows price, MV, P&L, WAL, DV01, plus
**IRR TO LIVE** (hold-to-maturity: cost → actuals to date → spliced
projections) and **FM IRR** (terminate today at the fund's mark). Totals
compute IRRs on the summed cashflow vectors.

![Portfolio](docs/screenshots/31-portfolio-irrs.png)

Positions can carry a **commitment** beyond the funded face (revolver-style):
the unfunded slice shows on the position and the treasury reads dry powder
both ways — gross, and **net of committed-but-unfunded** cash.

![Commitments](docs/screenshots/50-commitments.png)

### CLOSES — scenario artifacts, the FM close, and approval

Three kinds of frozen artifacts drive the month-end lifecycle:

1. **Scenario runs** — SAVE SCENARIO on RESULTS freezes the run (deal doc +
   stress + metrics) under any name you choose.
2. **Book closes** — CLOSE MONTH on the CLOSES tab assembles the FM package:
   every held deal's base-case run, the marks in force **with the marking
   rationale notes** (each mark book entry carries a "why"), and each fund's
   frozen analytics.
3. **FM approval** — FM loads the package, validates, and hits FM APPROVE:
   the close flips to `fm_approved`, tracked deals are forced to full engine
   closes, and the approved close becomes what the PORTFOLIOS **FM FINAL**
   view reports.

The close timeline **flags months where assumptions moved** (repline /
structure / mark changes vs the prior close, color-coded), and every
portfolio row shows its **GOOD THRU** date — the last FM-approved close
carrying that mark — colored green/amber/red by staleness.

When you load a deal to model a new month, the **OPEN FROM…** menu on DEALS
starts you from the FM close, the ABF close, or any saved scenario.

![Book close](docs/screenshots/46-book-close.png)
![Close timeline](docs/screenshots/47-close-timeline.png)
![Good through](docs/screenshots/48-good-through.png)
![FM final](docs/screenshots/49-fm-final.png)
![Open from](docs/screenshots/51-open-from.png)

### EXPORTS

Everything exports to `exports/{deal}/{YYYYMMDD}_{HHMMSS}_{scenario}_{artifact}.{ext}`
(deal workbook .xlsx, stack/cashflow/trigger tables .csv/.json, MC and matrix
results) or streams straight to the browser.

---

## Demo deals

`backend/scripts/make_demos.py` seeds three demos (safe to edit/delete;
re-run to restore):

- **demo-royalty-2026** — music-catalog royalty stream (decay, seasonality,
  payor default), A/B/R.
- **demo-clo-2026** — leveraged-loan CLO: per-class OC/IC coverage diversion,
  senior/sub fees, incentive fee over a 12% hurdle.
- **demo-forward-flow-2026** — 24-month origination ramp + warehouse
  draw/revolve/amortize facility.

## Repo layout

```
backend/            FastAPI: /api + built SPA on one port
  api/              routers: schema deals validate runs jobs analysis
                    actuals monitor portfolios exports
  core/             document/workspace/engine_bridge/tracking/jobs/stores
  scripts/          make_demos.py
  tests/            pytest suite
frontend/           React 19 + Vite + TS · React Query · Recharts · dnd-kit · mermaid
workspace/          deal + portfolio JSONs, closes/ (gitignored)
exports/            export target (gitignored)
docs/screenshots/   README images (captured from the live app)
```

## Notes & limits

- Run results live in an in-memory LRU; the UI re-runs on eviction. Deals are
  always on disk.
- Background jobs (MC, breakevens, sensitivities, matrices) run on a small
  thread pool; progress shows in the status bar; jobs are lost on restart.
- Forward-flow build-up pools don't support breakevens/MC/monitoring yet
  (no stable per-vintage repline ids); actuals don't combine with
  reinvestment/calls; all such combinations fail with clear messages.
- Covenants are factory-based (JSON-safe) by design — the engine's
  callable covenants can't round-trip through a document.

### Securitization takeouts

The **SECURITIZATION TAKEOUT** panel (Structure page) handles the
"balance-sheet / warehouse it, then securitize a month later" lifecycle in one
action: it seasons the pool to month k (balance from the remittance tape when
it covers month k, else the projection; assumption curves re-anchored to the
boundary using the engine's splice conventions), creates the term deal with
its own run date and a chosen structure, and sets the takeout call on the
warehouse deal at your sale price. Fund positions on the warehouse are kept —
the call terminates their cashflows with the payoff — so the fund's cash
ledger shows call proceeds in and term-deal purchases out in the same
calendar month, and dry powder bridges the handoff correctly.
