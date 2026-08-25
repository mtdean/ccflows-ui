# 02 — The `cashflows` engine contract (verified facts + gotchas)

Everything here was confirmed empirically against engine v1.2.0. These are
the constraints that shaped the backend — re-verify before assuming any has
changed.

## Basics

- **Field registry**: `REPLINE_FIELDS` (~82 fields) is the single source of
  truth for repline inputs. The UI's forms, knob menu, and validation are
  registry-driven — never hardcode field lists.
- **Horizon**: 361 months. Curves shorter than the horizon are padded by
  **repeating the last value** — a curve ending at a nonzero value keeps
  paying/losing forever. Loss timing curves must end at 0.
- **Percent conversion**: all docs build replines with
  `percent_conversion="strict"` — curves and rates are decimals, full stop.
  Warnings raised during `repline_from_dict` are surfaced as run warnings.
- **Serialization**: `repline_to_dict/from_dict` round-trips everything
  including `rr_matrix` (as nested lists). `save_repline_file` does NOT
  (drops rr_matrix) — never use it for persistence.

## Loss frameworks (priority order in `_determine_loss_type`)

`rr_matrix` > `pbad` (requires ead+lgd) > `cdr` > `cumulative_cash_collections`
(requires cgl>0) > `cumulative_gross_losses` > `loss_timing`.

- `loss_timing`: monthly chargeoff = `loss_timing[mob] × original_face` — the
  curve's SUM is lifetime CGL as a fraction of face.
- `cumulative_gross_losses`: chargeoff = month-over-month delta × face.
- CCC: `cgl × timing × face` where timing sums to 1.
- **Because `cdr` outranks the CGL frameworks, switching a repline to
  CGL+timing must zero the cdr curve** (the UI toggle does this).

## Splice / roll semantics (`cashflows.actuals.splice`)

The forward re-seed: `upb` = actual boundary balance, `age += k`, mob-indexed
curves shifted left by k. Three curve classes:

- `_SHIFT_CURVES`: shift only.
- `_FACE_ANCHORED_CURVES` (`loss_timing`, `prepayment_timing`): shifted then
  × `original_face / boundary_upb` — **dollar amounts of the original
  schedule are preserved**. Consequence: the engine's default roll does NOT
  hold CGL constant; an actuals under-run permanently lowers projected
  lifetime losses. The explicit alternative is ccflows-ui's
  `apply_cgl_policy` (see 03).
- `_CUMULATIVE_CURVES` (`cumulative_gross_losses`, `cumulative_cash_collections`):
  shifted, re-anchored to 0 at the boundary (subtracting the CURVE's value at
  k, not realized actuals), rescaled by face/boundary.

`splice_pipeline_deal(..., scenario=)` accepts **MACRO scenario names only**,
not `CurveStressMultipliers` — forward what-ifs resolve names.

`RemittanceData` requires unique `(repline_id, month)`; month 0 is the run
date. Reported interest seeds `interest_prinpay` (treated as fully current).

## Hard incompatibilities (guarded with 422s in the API)

- **Call + actuals**: `Cashflow(model, transforms=[("call", ...)])` cannot
  combine with a spliced source. Portfolio analytics and treasury instead
  apply `core.treasury.apply_call_overlay` to the spliced tranche cashflows
  (`out[:, k] += balance × price; out[:, k+1:] = 0`). Book closes fall back
  to an uncalled run with a warning.
- **Reinvestment** needs a single-engine, no-actuals, no-originations pool.
- **Splicing** needs a single collateral engine class (no mixed pools) and
  is unsupported on forward-flow (`build_portfolio`) vintage build-ups.
- **Monitoring/TrackedDeal** rejects origination pools (no stable repline
  ids across vintages).

## Waterfall / liabilities

- Spec codec `cashflows.waterfall/1` via `waterfall_from_dict/to_dict`.
- `IOStrip(name, coupon|margin+floating, notional_of)` and `WACIOStrip(name)`
  are legal stack members; `notional_of` must name a funded bond.
- `to_mermaid()` emits one flowchart with a `subgraph capital` — the UI
  splits it client-side (see 07).
- Trigger/covenant **callables are not JSON-serializable** — only the
  factory-based covenants (`COVENANT_FACTORIES`) are exposed, specs stored as
  `{factory, params, name, severity, ...}`.

## Engine curve-library attach — DO NOT USE

`ReplineConfig(curves=lib).get_final_repline()` **overwrites all 26 curves**
(unspecified ones reset to engine defaults) and passes `ead/lgd/limit_growth/
revolve_rate` through un-normalized (100.0). ccflows-ui therefore applies
libraries **curve-by-curve client-side** for only the curves a library
explicitly carries (`specified` list in the curveslib JSON), never via the
engine attach path.

## Rates

- Deal rates input is a DataFrame with a `date` column + rate columns; rows
  are MONTHLY. The model selects `index_rate` by column name and ignores the
  rest — multi-column frames are legal and encouraged.
- **`PensfordProvider`'s hardcoded XML URL is dead** (HubSpot 404 as of
  2026-08). ccflows-ui replaces the fetch (see 06); the engine class remains
  only as a fallback parser.

## Marks / positions

- `mark_position` / `SplicedDeal.position_marks` are used everywhere; the
  engine's own `Portfolio` class is NOT used (funds are a UI concept).
- `MarkSchedule({month: value}, method)` step functions; `TrackedDeal.pnl`
  accepts them as `spreads_or_yield=`.
- Engine per-deal closes: `tracked.close_month(store=CloseStore(...))`,
  raises `FileExistsError` on re-close without overwrite; drift via
  `tracked.drift_check(snapshot)`.
