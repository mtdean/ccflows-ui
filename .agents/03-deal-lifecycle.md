# 03 — Deal documents and the modeling lifecycle

## The deal document (`ccflows-ui.deal/1`)

One JSON per deal holds EVERYTHING: `meta`, `run` (run_date, replines,
originations), `waterfall`, `rates`, `stress`, `monte_carlo`, `call`,
`reinvestment`, `covenants`, `actuals` (the tapes travel inside the doc),
`export`, `ui_state`. Rationale: upload the file anywhere and the deal is
whole — history included.

- Repline entries: `{inline: <engine repline dict>, curve_specs: {...},
  cgl_policy?: "hold_constant"}`. `inline` is engine-native (travels through
  the engine codec). `curve_specs` are UI-only recipes (flat/ramp/vector) so
  reopening a curve editor shows handles, not just 361 numbers.
- **Drafts are legal.** Structural validation (is it shaped like a deal?)
  gates writes; full engine validation runs via `/validate/*` and hard-stops
  only on `/run`. An empty bond stack must be saveable.
- Slugs derive from `meta.name`; renaming re-slugs (PUT handles the move).

## Draft state (frontend)

`useDealDraft` context: server doc + local draft + localStorage crash mirror.
`openDealWith(slug, doc)` opens a deal with a SUPPLIED doc (frozen close /
scenario) via a pending-doc ref — it must land as a dirty draft against the
saved file so SAVE is an explicit adoption. Never write a loaded artifact
straight to disk.

## Validation policy

- `/validate/repline` + `/validate/waterfall` + `/validate/deal` return
  `{ok, errors[{loc, field, msg, hint}], warnings, lint}` — errors anchor to
  fields in the UI; lint is advisory (e.g. fee ordering).
- Engine `ValueError`s from runs surface as 422 with the engine's message
  verbatim — the engine's errors are good; don't paraphrase them.

## CGL + loss timing (the roll policy)

- Repline card offers one loss-input choice: **CDR vector** or **CGL +
  timing**. In CGL mode the stored `loss_timing` curve sums to CGL (of
  face); the CGL% field and the curve editor edit the same array (editing
  the curve moves the displayed CGL; editing CGL% rescales the curve).
  Switching modes zeroes the other framework's curve (cdr outranks
  loss_timing in engine detection).
- `engine_bridge.apply_cgl_policy(replines, doc)`: for entries flagged
  `cgl_policy: "hold_constant"` with a tape loaded, rescale the loss curve
  past the boundary so lifetime = CGL × face − realized tape chargeoffs.
  - loss_timing: `curve[k+1:] *= factor`,
    factor = (lifetime − realized) / (lifetime − planned_to_k).
  - cumulative_gross_losses: tail re-anchored at curve[k] and scaled.
  - Applied in BOTH `run_deal` (after stress, so a scenario's lifetime CGL
    is what gets held) and `tracking.build_tracked` (so monitoring and
    portfolio marks see the same projection). The tracking cache key covers
    `doc.run`, so flipping the policy invalidates correctly.
  - Notes go into run warnings; `/actuals/cgl-status` powers the ACTUALS
    panel (realized vs planned, forward factor). Skipped cases (wrong
    framework, exhausted curve) are noted, never silent.
- Verified identity: with an under-run tape, default roll lifetime =
  realized + planned-remaining (< CGL·face); hold_constant lifetime =
  exactly CGL·face (`tests/test_cgl_policy.py`).

## Calls, reinvestment, takeouts

- Call config lives in `doc.call`; run path builds `Call(...)` as a Cashflow
  transform. Reported `call_month_effective` resolves against the UNCALLED
  pool.
- Reinvestment (`doc.reinvestment`) uses `run_with_reinvestment` with a
  template repline; mutually exclusive with actuals/originations.
- **Securitization takeout** (`core/takeout.py` + `/deals/{slug}/securitize`):
  seasons the warehouse pool to month k (balances from the tape when covered,
  else the projection; curves re-anchored using the engine's own splice
  conventions), creates a term deal with its own run date, sets the takeout
  call on the warehouse. Fund roll keeps warehouse positions by default
  (`retire_warehouse=False`) — the call pays them off, so retiring them would
  erase the proceeds from the fund's cash history.

## Demo deals

`demo-auto-2026` (tape + pending call), `demo-auto-term-2027` (takeout
product), `demo-clo-2026`, `demo-forward-flow-2026` (origination build-up),
`demo-royalty-2026`, `cgl-royalty-warehouse` (CGL framework + tape +
hold-constant). Demo tapes are engineered so trustee note balances stay
inside the spliced pool balance — the engine hard-errors otherwise; keep
that invariant when editing them.
