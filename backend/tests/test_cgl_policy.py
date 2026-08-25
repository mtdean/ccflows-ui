"""Hold-CGL-constant roll policy: forward loss rescaling given tape actuals."""

import numpy as np
import pandas as pd
import pytest

from core import engine_bridge
from core.document import new_deal

CGL = 0.08
FACE = 50_000_000.0
K = 6


def _cgl_doc(policy=None, underrun=0.5):
    doc = new_deal("cgl-fixture")
    timing = np.zeros(361)
    timing[1:49] = CGL / 48  # sums to CGL over 48 months
    entry = doc["run"]["replines"][0]
    entry["inline"].update({"upb": FACE, "term": 60, "cdr": [0.0],
                            "loss_timing": timing.tolist()})
    if policy:
        entry["cgl_policy"] = policy
    rows, upb = [], FACE
    for m in range(1, K + 1):
        chg = CGL / 48 * FACE * underrun
        sched = FACE / 60
        prepay = upb * 0.008
        upb = upb - sched - prepay - chg
        rows.append({"repline_id": "repline_1", "month": m, "upb_end": upb,
                     "interest_collected": upb * 0.01, "principal_collected": sched,
                     "prepayments": prepay, "chargeoffs": chg, "recoveries": chg * 0.3})
    doc["actuals"] = {"collateral": rows}
    return doc


def _lifetime_chargeoffs(doc):
    from cashflows.actuals import RemittanceData, splice_actuals

    replines, _ = engine_bridge.build_replines(doc)
    engine_bridge.apply_cgl_policy(replines, doc)
    _, models, _ = engine_bridge.run_collateral(replines, doc["rates"],
                                                doc["run"]["run_date"])
    spliced = splice_actuals(models[0],
                             RemittanceData(pd.DataFrame(doc["actuals"]["collateral"])))
    return float(np.asarray(spliced.upb_chargeoff).sum())


def test_default_roll_lets_underrun_flow_through():
    total = _lifetime_chargeoffs(_cgl_doc(policy=None))
    realized = CGL / 48 * FACE * 0.5 * K
    assert total == pytest.approx(realized + (CGL * FACE - CGL / 48 * FACE * K), rel=1e-6)
    assert total < CGL * FACE  # lifetime drifted below the CGL anchor


def test_hold_constant_pins_lifetime_to_cgl():
    total = _lifetime_chargeoffs(_cgl_doc(policy="hold_constant"))
    assert total == pytest.approx(CGL * FACE, rel=1e-6)


def test_hold_constant_with_overrun_scales_down():
    total = _lifetime_chargeoffs(_cgl_doc(policy="hold_constant", underrun=1.6))
    assert total == pytest.approx(CGL * FACE, rel=1e-6)


def test_run_deal_carries_policy_note():
    run = engine_bridge.run_deal(_cgl_doc(policy="hold_constant"))
    assert any("CGL held constant" in w for w in run.warnings)


def test_policy_on_wrong_framework_noted_not_applied():
    doc = _cgl_doc(policy="hold_constant")
    entry = doc["run"]["replines"][0]
    entry["inline"]["loss_timing"] = [0.0]
    entry["inline"]["cdr"] = [0.02 / 12] * 361  # cdr framework now
    run = engine_bridge.run_deal(doc)
    assert any("cgl_policy ignored" in w for w in run.warnings)


def test_cgl_status_endpoint(client):
    doc = _cgl_doc(policy="hold_constant")
    resp = client.post("/api/actuals/cgl-status", json={"doc": doc})
    assert resp.status_code == 200
    rows = resp.json()["replines"]
    assert len(rows) == 1
    row = rows[0]
    assert row["policy"] == "hold_constant"
    assert row["boundary_month"] == K
    assert row["lifetime_cgl"] == pytest.approx(CGL * FACE)
    assert row["realized"] == pytest.approx(CGL / 48 * FACE * 0.5 * K)
    assert row["forward_factor"] == pytest.approx(
        (CGL * FACE - row["realized"]) / (CGL * FACE - row["planned_to_boundary"]))
