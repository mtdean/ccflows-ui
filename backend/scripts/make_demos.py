"""
Seed three demo deals into the workspace, built with engine-native
serialization so every section round-trips through cashflows itself:

  demo-royalty-2026       — music-catalog royalty stream, A/B/R
  demo-clo-2026           — leveraged-loan CLO with OC/IC coverage tests
  demo-forward-flow-2026  — forward-flow purchase program: 24-month
                            origination ramp, warehouse draw/revolve/amortize

Run: .venv/bin/python scripts/make_demos.py   (from backend/)
"""

import sys
from datetime import date
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402
from core import workspace  # noqa: E402
from core.document import DOC_SCHEMA, now_iso  # noqa: E402

from cashflows import ReplineInputs  # noqa: E402
from cashflows.liabilities import from_clo, warehouse_waterfall  # noqa: E402
from cashflows.liabilities.spec import waterfall_to_dict  # noqa: E402
from cashflows.securitization.tranches import CoverageTest, TrancheSpec  # noqa: E402
from cashflows.serialize.recipe import repline_to_dict  # noqa: E402

RUN_DATE = date.today().replace(day=1).isoformat()


def base_doc(name: str, notes: str) -> dict:
    return {
        "schema": DOC_SCHEMA,
        "meta": {"name": name, "slug": "", "created": now_iso(), "modified": now_iso(),
                 "tags": ["demo"], "notes": notes},
        "run": {"run_date": RUN_DATE, "replines": []},
        "waterfall": None,
        "rates": {"mode": "flat", "rate": 0.043, "index": "sofr_1m"},
        "stress": {"scenario": "base", "custom_multipliers": None, "macro_scenario": None},
        "monte_carlo": {"n_sims": 1000, "seed": 42, "store_paths": True,
                        "samplers": [{"field": "cdr", "type": "lognormal", "sigma": 0.25, "rho": 0.0}]},
        "export": {"folder": None, "price": 100.0},
        "ui_state": {},
    }


def entry(repline: ReplineInputs) -> dict:
    return {"inline": repline_to_dict(repline)}


# ── 1. Royalty ─────────────────────────────────────────────────────────────

def royalty_deal() -> dict:
    doc = base_doc(
        "Demo Royalty 2026",
        "Music catalog royalty securitization: $10M purchase of a decaying, "
        "seasonal royalty stream with payor default risk. A/B/R sequential.")
    repline = ReplineInputs(
        repline_id="music_catalog",
        amortization_type="royalty",
        upb=10_000_000.0,
        term=120,
        cdr=np.zeros(361), cpr=np.zeros(361),
        royalty_income_curve=np.full(361, 150_000.0),
        royalty_decay_rate=np.full(361, 0.008),
        royalty_seasonality=np.array([1.10, 0.95, 0.90, 0.95, 1.00, 1.00,
                                      0.95, 0.95, 1.00, 1.05, 1.10, 1.15]),
        payor_default_rate=np.full(361, 0.01),
        recovery_rate=0.50, recovery_timing=3,
    )
    doc["run"]["replines"] = [entry(repline)]
    doc["monte_carlo"]["samplers"] = [
        {"field": "royalty_decay_rate", "type": "lognormal", "sigma": 0.3, "rho": 0.2},
        {"field": "payor_default_rate", "type": "lognormal", "sigma": 0.4, "rho": 0.0},
    ]
    doc["waterfall"] = {
        "schema": "cashflows.waterfall/1",
        "reserve_initial": 100_000.0,
        "bonds": [
            {"type": "bond", "name": "A", "size_pct": 0.70, "balance": None, "coupon": 0.065,
             "margin": None, "floating": False, "pik": False, "rate_cap": None, "rate_floor": None},
            {"type": "bond", "name": "B", "size_pct": 0.15, "balance": None, "coupon": 0.095,
             "margin": None, "floating": False, "pik": False, "rate_cap": None, "rate_floor": None},
            {"type": "residual", "name": "R", "balance": None},
        ],
        "triggers": [],
        "steps": [
            {"name": "servicing", "type": "fee", "annual_rate": 0.005, "basis": "pool",
             "cap": None, "fixed_annual": None},
            {"name": "A_interest", "type": "pay_interest", "bonds": ["A"], "reserve_draw": True, "sources": None},
            {"name": "B_interest", "type": "pay_interest", "bonds": ["B"], "reserve_draw": False, "sources": None},
            {"name": "reserve", "type": "reserve_deposit", "target_pct": 0.01, "target": None},
            {"name": "principal", "type": "pay_principal", "bonds": [], "rule": "sequential",
             "amount": "collections", "sources": None},
            {"name": "residual", "type": "pay_residual"},
        ],
    }
    return doc


# ── 2. CLO ─────────────────────────────────────────────────────────────────

def clo_deal() -> dict:
    doc = base_doc(
        "Demo CLO 2026",
        "Leveraged-loan CLO: floating collateral, per-class OC/IC coverage "
        "diversion, senior/sub fees, manager incentive fee over a 12% hurdle.")
    repline = ReplineInputs(
        repline_id="lev_loans",
        amortization_type="simple",
        upb=400_000_000.0,
        gross_wac=0.0925, net_wac=0.0895,
        term=72, age=6,
        floating_rate=True,
        cdr=np.full(361, 0.03 / 12), cpr=np.full(361, 0.25 / 12),
        recovery_rate=0.65, recovery_timing=9,
        cost_servicing=0.003,
    )
    doc["run"]["replines"] = [entry(repline)]
    tranches = [
        TrancheSpec("A", size_pct=0.62, margin=0.0145, floating=True),
        TrancheSpec("B", size_pct=0.12, margin=0.0210, floating=True),
        TrancheSpec("C", size_pct=0.08, margin=0.0325, floating=True, deferrable=True),
        TrancheSpec("D", size_pct=0.06, margin=0.0550, floating=True, deferrable=True),
        TrancheSpec("R", is_residual=True),
    ]
    wf = from_clo(
        tranches,
        coverage_tests=[CoverageTest(tranche="B", oc_trigger=1.18, ic_trigger=1.10),
                        CoverageTest(tranche="D", oc_trigger=1.05, ic_trigger=1.02)],
        senior_fee_bps=40.0, sub_fee_bps=30.0,
        incentive_hurdle=0.12, incentive_share=0.20,
        servicing_fee=0.0015,
        reserve_target_pct=0.005,
    )
    doc["waterfall"] = waterfall_to_dict(wf)
    return doc


# ── 3. Forward flow ────────────────────────────────────────────────────────

def forward_flow_deal() -> dict:
    doc = base_doc(
        "Demo Forward Flow 2026",
        "Forward-flow purchase program: 24-month origination ramp builds the "
        "pool (prime/near-prime mix) while a warehouse facility draws against "
        "purchases, revolves collections through month 23, then amortizes. "
        "The origination schedule lives under COLLATERAL.")
    prime = ReplineInputs(
        repline_id="prime", amortization_type="simple",
        upb=1_000_000.0,  # unit face — the origination schedule sets the dollars
        gross_wac=0.14, net_wac=0.125, term=48,
        distribution=0.6,
        cdr=np.full(361, 0.02 / 12 * 12 / 12), cpr=np.full(361, 0.12 / 12),
        recovery_rate=0.40, recovery_timing=6,
    )
    near = ReplineInputs(
        repline_id="near_prime", amortization_type="simple",
        upb=1_000_000.0,
        gross_wac=0.19, net_wac=0.17, term=36,
        distribution=0.4,
        cdr=np.full(361, 0.05 / 12), cpr=np.full(361, 0.10 / 12),
        recovery_rate=0.35, recovery_timing=6,
    )
    doc["run"]["replines"] = [entry(prime), entry(near)]
    # 24-month ramp: $2M -> $5M/month plateau -> $3M taper
    schedule = [2e6, 2.5e6, 3e6, 3.5e6] + [5e6] * 8 + [3e6] * 12
    doc["run"]["originations"] = {"schedule": schedule}
    wf = warehouse_waterfall(
        credit_line=60_000_000.0,
        advance_rate=0.85,
        draw_months=11,
        recycle_months=23,
        senior_margin=0.0275,
        servicing_fee=0.0015,
    )
    doc["waterfall"] = waterfall_to_dict(wf)
    doc["monte_carlo"]["samplers"] = [{"field": "cdr", "type": "lognormal", "sigma": 0.3, "rho": 0.1}]
    return doc


def main() -> None:
    config.ensure_dirs()
    for build in (royalty_deal, clo_deal, forward_flow_deal):
        doc = build()
        saved = workspace.save(doc)
        print(f"seeded {saved['meta']['slug']}")


if __name__ == "__main__":
    main()
