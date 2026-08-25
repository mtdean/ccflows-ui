# 04 — Funds, marks, IRRs, treasury

## Funds (portfolios)

One `{slug}.portfolio.json` per fund. Positions =
`{deal, tranche, face, cost_basis, acquired_month?, commitment?}`.
Funds are a UI concept — the engine's `Portfolio` class is not used.

The analytics view (`GET /portfolios/{slug}/analytics`) re-runs stale deals
automatically: deals with actuals go through the tracked/spliced path and are
marked AT THE SPLICE BOUNDARY; projection-only deals use a cached base run
(`portfolio_store.cached_base_run`, content-hashed). One broken deal never
kills the view — its rows carry `error`.

## Mark resolution (precedence, everywhere)

**position override > workspace mark book > fund default.**
The mark book (`marks.json`) is the shared (deal, tranche) → {method,
schedule, note} map; schedules are step functions keyed by month
(`{0: 200, 8: 250}`), mirroring the engine's `MarkSchedule`. The `note` is
the marking rationale — it surfaces on portfolio tooltips and is FROZEN into
book closes for FM to validate. An empty schedule deletes the entry.

## IRR definitions (fixed vocabulary — keep names stable)

- **IRR TO LIVE**: hold-to-maturity. Position vector = −cost at acquisition,
  then share × tranche combined cashflows (actuals through the boundary,
  spliced projections after). Solved by bisection on monthly compounding,
  annualized ×12; None when no sign change.
- **FM IRR**: fair-market exit. Same actual cashflows through the boundary,
  then terminate at the boundary with market value + accrued at the fund's
  CURRENT mark. Only exists once a tape exists.
- Portfolio totals compute IRRs on the SUMMED cashflow vectors, never by
  averaging position IRRs.
- Pending calls on taped deals: `apply_call_overlay` is applied to the
  combined tranche cashflows before IRR/mark math (engine can't model
  call+actuals directly — see 02).

## Fund P&L

Engine per-position fair-value statements (`tracked.pnl` with book-schedule
marks) aggregated onto the calendar: **sum across positions per month FIRST,
then bucket** (begin = first month's begin, end = last month's end). Getting
this order wrong double-counts begin/end MV — it's tested.

## Treasury (the "Excel" cash ledger)

`core/treasury.build_ledger(doc, horizon)` — monthly calendar rows anchored
via `pd.Period`: deal month m lands at run_date + m.

- Columns: opening, contributions, distributions, credit draws/repays/
  interest, purchases, per-deal receipts, net, closing, drawn, available,
  dry powder, dry powder net.
- **Credit interest accrues on the balance carried INTO the month** — a draw
  this month starts paying interest next month. Tested.
- Draws clip to the limit, repays clip to drawn — with a note, never
  silently.
- Identity (tested): closing = opening + net for every row.
- **Commitments**: positions may carry `commitment` ≥ funded face
  (revolver-style). `unfunded = max(commitment − face, 0)`.
  `dry_powder` = cash + undrawn credit (gross);
  `dry_powder_net` = gross − Σ unfunded. Both are first-class — the desk
  asked to see cash inclusive AND exclusive of committed-but-unfunded.
- Takeout months show call proceeds in and term purchases out in the same
  calendar month (the whole warehouse→term handoff is visible in one row).

## Good-through (see 05 for the close side)

Each analytics row carries `good_through` = the latest FM-APPROVED book
close whose marks section covers that (deal, tranche). UI colors by age:
≤1 month green, 2–3 amber, older/none red. This is the "when did FM last
bless this mark" signal.
