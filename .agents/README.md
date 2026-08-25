# .agents/ — decision log for ccflows-ui

This folder is the written memory of how and why this app is built the way it
is. It exists so that any agent or engineer — including a fork living in a
different org — can extend the app without re-deriving the engine's sharp
edges or silently breaking a deliberate convention.

**Treat this repo as the source of truth.** If you fork it and diverge,
append your own decisions here rather than rewriting history; each file notes
the constraint that forced the decision, which is the part that stays true
even when the code moves.

## Index

| File | Covers |
|---|---|
| [01-architecture.md](01-architecture.md) | Stack, layout, ports, persistence model, how to run |
| [02-engine-contract.md](02-engine-contract.md) | Every verified fact + gotcha about the `cashflows` engine |
| [03-deal-lifecycle.md](03-deal-lifecycle.md) | Deal document design, validation policy, CGL roll policy, calls/reinvestment/takeouts |
| [04-portfolio-marks-treasury.md](04-portfolio-marks-treasury.md) | Funds, mark resolution, IRR definitions, cash ledger, commitments |
| [05-closes-artifacts.md](05-closes-artifacts.md) | Scenario runs, the FM book close, approval, good-through |
| [06-rates-curves.md](06-rates-curves.md) | Rates modes, Pensford crawler, curve libraries |
| [07-frontend-conventions.md](07-frontend-conventions.md) | Theme, component idioms, draft state, color semantics |
| [08-testing-verification.md](08-testing-verification.md) | Test layout, empirical verification bar, browser drives |

## The two rules that generated most decisions

1. **The engine is the authority.** Anything the engine can serialize travels
   through the engine's own codecs (`repline_to_dict/from_dict`,
   `waterfall_to_dict/from_dict`, `rates_to_records`). The UI never invents a
   parallel representation of something the engine already defines — it only
   wraps engine-native payloads in thin JSON envelopes with a `schema` tag.
2. **Verify empirically, not by reading.** Every engine integration was
   confirmed by running the engine and checking an identity (price at own
   coupon = 100, ledger closing = opening + net, P&L ties to
   (price − cost)/100 × face × factor, spliced lifetime losses = CGL × face,
   …). When extending, add the identity to the test suite — see
   [08-testing-verification.md](08-testing-verification.md).
