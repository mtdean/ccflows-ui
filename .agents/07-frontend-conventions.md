# 07 — Frontend conventions

## Look

Dark terminal theme (globals.css copied from the user's situation-monitor
tool and extended): IBM Plex Mono, uppercase labels, orange accent.
Tokens: `--positive #00c176`, `--negative #ff3b3b`, `--warning #ffaa00`,
`--text-accent` (orange), `--text-dim`. Classes `.pos .neg .dim`, `.chip` /
`.chip--active`, `.btn`, `.input`, `.field-row`, `.knob-menu`, `Panel`
(title/subtitle/actions), `DataTable` (typed columns, sortable), shared
`EmptyState` / `LoadingCursor`.

## Color semantics (keep consistent when extending)

- green = actuals/approved/fresh/healthy (TAPE chips, FM APPROVED,
  good-through ≤1mo, dry powder, held-by-fund markers);
- amber = attention/policy/pending (UNSAVED, CALL, CGL, ABF awaiting FM,
  unfunded commitments, stale, repline-change flags);
- red = broken/severe/stale (errors, structure-change flags, severe stress,
  good-through >3mo);
- orange accent = identity/selection (tranche names, active tab, marks flags);
- dim = default/projection/no-data.
Scenario severity dots: base green, mild/moderate amber, severe/recession red.

## State

- ALL server state through React Query; cache keys centralized in
  `lib/queryKeys.ts` — never inline key arrays.
- `lib/api.ts` is the only fetch layer (typed function per endpoint).
- Deal draft: `useDealDraft` provider — server doc, local draft, dirty flag,
  localStorage crash mirror with restore prompt, `openDealWith` for loading
  frozen artifacts (pending-doc ref beats the async-load race; the loaded
  doc lands DIRTY so SAVE is explicit adoption).
- Runs: `useRuns` registry keyed by scenario per deal, with doc-hash
  staleness ("⚠ DEAL EDITED SINCE RUN").

## Idioms

- Debounce-then-query for expensive previews (validation, mermaid) on a
  content hash; keep the stale render visible while the next one computes.
- `window.prompt/confirm/alert` are acceptable for rare, blocking choices
  (this is a desk tool, not a product) — but inline panels for anything used
  often.
- Curve editing: `curve_specs` recipes (flat/ramp/vector + paste box);
  sparkline summaries on the card via `curveSummary`/`sparklinePoints`.
- Tables that can overflow get their own `overflow-x: auto` wrapper.

## The mermaid FLOW panel

The engine emits ONE flowchart with a `subgraph capital` beside the step
chain, which squeezed the waterfall. `MermaidPreview.splitDiagram` splits the
text client-side: the capital subgraph becomes its own `flowchart LR`
rendered ABOVE (with an invisible `a ~~~ b ~~~ c` chain — mermaid ignores
subgraph `direction` on edge-less nodes, the chain pins one horizontal row),
and the remaining waterfall renders below at full width. If the engine's
mermaid output format changes, this splitter is the thing to revisit.

## Status bar

Bottom bar: engine health dot, workspace-folder check (tooltip lists every
required folder ✓/✗; /health self-heals missing ones), open deal + dirty
state, last run + staleness, active background jobs with progress.
