# 05 — Saved artifacts and the month-end close lifecycle

Three frozen-artifact kinds (`core/artifact_store.py`), all self-contained:
they embed the FULL deal document(s), so loading one reproduces exactly what
was run — no dependency on the in-memory results cache or current workspace
state.

## Scenario runs — `workspace/scenarios/{deal}/{name}.json`

`POST /deals/{slug}/scenario-runs` re-runs the engine AT SAVE TIME (doc +
scenario/custom multipliers/macro + price) and freezes doc, stress config,
tranche metrics, warnings. Saved from RESULTS → SAVE SCENARIO. Named by the
user ("Severe Stress Committee") — the name is the point; these are the
"call it whatever we want" artifacts.

## Book closes — `workspace/book_closes/{YYYY-MM}.json`

The FM package. `POST /book-closes {month}` assembles, for **every deal held
by any fund**:

- the deal's base-case run (actuals spliced) with per-tranche metrics and
  the full doc snapshot;
- fingerprints (`sha256[:16]` of replines / waterfall JSON) for the
  timeline diff;
- the marks in force per held tranche — method, schedule, value at the
  deal's boundary, and **the rationale note** from the mark book;
- each fund's frozen analytics (positions, MV, P&L, IRRs).

Deals that fail to run land in `skipped` with the reason (never fatal).
Call+actuals deals fall back to an uncalled run with an explicit warning
(fund analytics apply the call overlay — see 02). Duplicate month → 409
unless `overwrite`.

## Status flow: `abf` → `fm_approved`

- Created closes are `abf` (built by the desk, awaiting FM).
- `POST /book-closes/{month}/approve {approver}`:
  - flips status, stamps approved_by/at;
  - **forces engine closes**: every deal in the package with actuals gets
    `tracked.close_month(store=CloseStore)` for its latest tape month —
    best-effort, per-deal outcomes recorded in `engine_closes`
    ("closed month 8" / "month already closed" / "no actuals" / error);
  - re-approval → 409. Deleting an approved close needs `?force=true`.
- The **latest approved close** powers:
  - `GET /portfolios/{slug}/fm-final` — the frozen FINAL portfolio view
    (what the fund officially reports);
  - the good-through index (`approved_mark_index`): (deal, tranche) → the
    latest approved close carrying that mark.

## Timeline diff flags

`GET /book-closes` compares consecutive months' fingerprints and reports,
per close: `changes.replines[]`, `changes.structure[]`, `changes.marks[]`
(deal slugs), plus `new_deals`. The CLOSES tab renders these as colored
chips — the "where did assumptions move" scan the desk asked for. Diffs are
computed on read from stored fingerprints, so old closes never need
rewriting.

## Load-a-new-month flow

`GET /deals/{slug}/sources` lists the scenarios + closes carrying that deal;
`POST /deals/{slug}/load-source {kind, ref}` returns the frozen doc. The UI
(DEALS → OPEN FROM…) drops it into the draft via `openDealWith` — dirty,
unsaved, so adopting the frozen state is an explicit SAVE. This is the
"load a month, then pick the FM close / ABF close / a scenario" entry point.

## Design choices worth keeping

- Closes embed docs rather than referencing them: a close must stay readable
  after deals are edited, renamed, or deleted.
- Approval is honor-system (no auth) — see 01.
- Everything FM sees (runs, marks, notes, analytics) is in ONE file a human
  can read; that file IS the deliverable to the FM team.
