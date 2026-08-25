"""
ccflows-ui/backend/core/document.py
The deal document: the one JSON that holds a whole deal (collateral, structure,
rates, stress, monte carlo, export prefs, opaque UI state).

Engine-native sections travel verbatim through the engine's own codecs
(`cashflows.serialize.recipe.repline_to_dict/from_dict`,
`cashflows.liabilities.spec.waterfall_to_dict/from_dict`), so the parts stay
loadable by `cashflows` directly.

Documents are allowed to be *drafts*: an empty bond stack or a repline still
being filled in must be saveable. Structural validation (is it shaped like a
deal doc?) is enforced on write; full engine validation runs via the /validate
endpoints and hard-stops only on /run.
"""

import re
from datetime import date, datetime, timezone
from typing import Any

DOC_SCHEMA = "ccflows-ui.deal/1"

SECTION_KEYS = ("schema", "meta", "run", "waterfall", "rates", "stress", "monte_carlo", "export", "ui_state")


class DocumentError(ValueError):
    """Structural problem with a deal document (maps to 422)."""

    def __init__(self, message: str, loc: list[str | int] | None = None):
        self.loc = loc or []
        super().__init__(message)


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    if not slug:
        raise DocumentError("Deal name must contain at least one letter or digit", ["meta", "name"])
    return slug[:64]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_deal(name: str) -> dict[str, Any]:
    """A starter deal: one auto-loan repline and an A/B/R sequential structure,
    ready to run out of the box."""
    flat = lambda v: [v] * 361  # noqa: E731
    return {
        "schema": DOC_SCHEMA,
        "meta": {
            "name": name,
            "slug": slugify(name),
            "created": now_iso(),
            "modified": now_iso(),
            "tags": [],
            "notes": "",
        },
        "run": {
            "run_date": date.today().replace(day=1).isoformat(),
            "replines": [
                {
                    "inline": {
                        "repline_id": "repline_1",
                        "amortization_type": "simple",
                        "upb": 100_000_000.0,
                        "gross_wac": 0.115,
                        "net_wac": 0.10,
                        "term": 60,
                        "age": 0,
                        "cdr": flat(0.02 / 12),
                        "cpr": flat(0.10 / 12),
                        "recovery_rate": 0.40,
                        "recovery_timing": 6,
                    },
                    "curve_specs": {
                        "cdr": {"mode": "flat", "value": 0.02 / 12},
                        "cpr": {"mode": "flat", "value": 0.10 / 12},
                    },
                }
            ],
        },
        "waterfall": {
            "schema": "cashflows.waterfall/1",
            "reserve_initial": 0.0,
            "bonds": [
                {"type": "bond", "name": "A", "size_pct": 0.85, "balance": None, "coupon": 0.055,
                 "margin": None, "floating": False, "pik": False, "rate_cap": None, "rate_floor": None},
                {"type": "bond", "name": "B", "size_pct": 0.10, "balance": None, "coupon": 0.075,
                 "margin": None, "floating": False, "pik": False, "rate_cap": None, "rate_floor": None},
                {"type": "residual", "name": "R", "balance": None},
            ],
            "triggers": [],
            "steps": [
                {"name": "servicing", "type": "fee", "annual_rate": 0.01, "basis": "pool",
                 "cap": None, "fixed_annual": None},
                {"name": "A_interest", "type": "pay_interest", "bonds": ["A"], "reserve_draw": False, "sources": None},
                {"name": "B_interest", "type": "pay_interest", "bonds": ["B"], "reserve_draw": False, "sources": None},
                {"name": "principal", "type": "pay_principal", "bonds": [], "rule": "sequential",
                 "amount": "collections", "sources": None},
                {"name": "residual", "type": "pay_residual"},
            ],
        },
        "rates": {"mode": "flat", "rate": 0.043, "index": "sofr_1m"},
        "stress": {"scenario": "base", "custom_multipliers": None, "macro_scenario": None},
        "monte_carlo": {"n_sims": 1000, "seed": 42, "store_paths": True, "samplers": [
            {"field": "cdr", "type": "lognormal", "sigma": 0.25, "rho": 0.0},
        ]},
        "call": {"enabled": False, "call_month": None, "nc_months": 0,
                 "call_price_pct": 100.0, "clean_up_call": False, "clean_up_call_pct": 0.10},
        "reinvestment": {"enabled": False, "reinvest_months": 24, "template_repline_id": None,
                         "purchase_price_pct": 100.0, "reinvest_share": 1.0, "max_iterations": 5},
        "covenants": [],
        "export": {"folder": None, "price": 100.0},
        "ui_state": {},
    }


def check_structure(doc: Any) -> None:
    """Structural validation: shaped like a deal document. Raises DocumentError."""
    if not isinstance(doc, dict):
        raise DocumentError("Deal document must be a JSON object")
    if doc.get("schema") != DOC_SCHEMA:
        raise DocumentError(f"Unsupported document schema {doc.get('schema')!r} (want {DOC_SCHEMA!r})", ["schema"])
    meta = doc.get("meta")
    if not isinstance(meta, dict) or not isinstance(meta.get("name"), str) or not meta.get("name"):
        raise DocumentError("meta.name is required", ["meta", "name"])
    run = doc.get("run")
    if not isinstance(run, dict) or not isinstance(run.get("replines"), list):
        raise DocumentError("run.replines must be a list", ["run", "replines"])
    for i, entry in enumerate(run["replines"]):
        if not isinstance(entry, dict) or not isinstance(entry.get("inline"), dict):
            raise DocumentError("each repline entry needs an 'inline' object", ["run", "replines", i])
        if not entry["inline"].get("repline_id"):
            raise DocumentError("repline_id is required", ["run", "replines", i, "inline", "repline_id"])
    wf = doc.get("waterfall")
    if wf is not None and not isinstance(wf, dict):
        raise DocumentError("waterfall must be an object or null", ["waterfall"])
    rates = doc.get("rates")
    if not isinstance(rates, dict) or rates.get("mode") not in ("flat", "records"):
        raise DocumentError("rates.mode must be 'flat' or 'records'", ["rates", "mode"])
    for key, typ in (("stress", dict), ("monte_carlo", dict), ("export", dict), ("ui_state", dict)):
        if key in doc and doc[key] is not None and not isinstance(doc[key], typ):
            raise DocumentError(f"{key} must be an object", [key])


def normalize(doc: dict[str, Any]) -> dict[str, Any]:
    """Fill defaults for optional sections and sync slug/modified."""
    base = new_deal(doc["meta"]["name"])
    for key in ("stress", "monte_carlo", "export", "ui_state", "call", "reinvestment", "covenants"):
        doc.setdefault(key, base[key])
    doc["meta"].setdefault("tags", [])
    doc["meta"].setdefault("notes", "")
    doc["meta"].setdefault("created", now_iso())
    doc["meta"]["slug"] = slugify(doc["meta"]["name"])
    doc["meta"]["modified"] = now_iso()
    return doc


def summary(doc: dict[str, Any]) -> dict[str, Any]:
    """One list-row of a deal for GET /deals."""
    wf = doc.get("waterfall") or {}
    replines = (doc.get("run") or {}).get("replines") or []
    upb = 0.0
    for entry in replines:
        try:
            upb += float(entry.get("inline", {}).get("upb", 0) or 0)
        except (TypeError, ValueError):
            pass
    return {
        "slug": doc["meta"]["slug"],
        "name": doc["meta"]["name"],
        "modified": doc["meta"].get("modified"),
        "tags": doc["meta"].get("tags", []),
        "n_replines": len(replines),
        "n_bonds": len(wf.get("bonds") or []),
        "total_upb": upb,
    }
