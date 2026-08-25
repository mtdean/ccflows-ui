# 06 — Rates and curve libraries

## Deal rates modes (`doc.rates`)

- `flat` — `{rate, index}` (decimal annual).
- `named` — `{curve: <workspace slug>, index: <column>}`; resolved by
  `core/rates.build_rates` from the workspace store at run time.
- `records` — inline `[{date, col: rate, ...}]` rows (the CSV-upload path).

Rows are MONTHLY; multi-column frames are legal (the model picks
`index_rate` by name). `validate_rates` runs in `/validate/deal`.

## Workspace rate curves (`{slug}.rates.json`)

Builders: flat, month-point curve (`CurveRatesProvider`, linear interp),
CSV upload (client papaparse → PUT records), and Pensford.

## The Pensford crawler (`core/pensford_crawler.py`)

**History**: the engine's `PensfordProvider` fetched a HubSpot-hosted XML
file. Pensford deleted it (404) and moved the curve behind their Next.js
site's own API. The crawler now:

1. `GET https://pensford.com/forward-curve` with a browser User-Agent —
   this sets the session cookie the API requires;
2. `GET https://pensford.com/api/forward-curve/projection?table=forward_curve`
   (same session + Referer) → ~29k daily rows, 10 years,
   `{reset_date, rate_label, rate_value}` in PERCENT;
3. pivots labels → engine-compatible columns
   (`sofr_1m_term`, `sofr_3m_term`, `sofr_1m_isda`, `sofr_daily`,
   `sofr_30d_avg`, `prime`, plus `sofr_1m` = alias of 1M Term — same names
   the old XML parse produced), resamples **daily → month-start**, /100 to
   decimals;
4. upserts workspace curve `pensford-sofr` with `meta.fetched_at`;
5. falls back to the legacy XML URL if the API shape reverts.

Other known endpoints on that API (same session dance):
`/api/forward-curve/fed-funds`, `/fomc-history`, `/caplet-volatility`,
`/last-updated`, `/api/live-rates` (spot), and `projection?table=` also
accepts `implied_treasury`, `sofr_swaps`, `fed_funds_fwd_curve`.

**Daemon**: a `threading` daemon started in the FastAPI lifespan; fetch on
start then every `CCFLOWS_PENSFORD_INTERVAL_HOURS` (default 24).
`CCFLOWS_PENSFORD_AUTO=0` disables (tests set this in conftest — never let
the suite hit the network). Failures never raise; `last_error` is kept for
the status chip. Endpoints: `GET /pensford/status`, `POST /pensford/refresh`
(502 with reason on failure). UI: freshness chip (green <36h, amber stale,
red error) + FETCH NOW on the RATE CURVES panel.

**Upstream note**: the engine's own `PensfordProvider.url` should eventually
be fixed in the `ccflows` repo; ccflows-ui deliberately did not patch the
engine.

## Curve libraries (`{slug}.curveslib.json`)

Engine `CurveLibrary.to_dict()` + a `specified: [names]` list recording WHICH
curves the library explicitly carries. Apply is **frontend-only and
curve-by-curve** — for each specified name, write the vector into
`entry.inline[name]` + a `curve_specs` recipe. NEVER use the engine's
`ReplineConfig(curves=lib)` attach (it resets unspecified curves to defaults
and leaves ead/lgd at 100 — see 02). Libraries are created from a repline
card ("SAVE CURVES AS LIBRARY", via engine `extract_curves_from_repline`)
or listed/deleted on the DEALS page.

## Bloomberg (deferred by the user)

The named-curve store IS the socket: a Bloomberg feed just needs to write
`{date, col: rate}` records into a workspace curve (one more builder mode or
an external script PUTting `/rates-curves/{slug}`). The user is wiring this
themselves when they have terminal connectivity.
