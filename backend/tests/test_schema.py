"""Schema introspection endpoints mirror the engine registries exactly."""


def test_repline_fields_match_registry(client):
    from cashflows.dataclasses.field_registry import REPLINE_FIELDS

    data = client.get("/api/schema/repline-fields").json()
    editable = [f for f in REPLINE_FIELDS if f.kind != "derived_str"]
    assert len(data["fields"]) == len(editable)
    names = {f["name"] for f in data["fields"]}
    assert "loss_type" not in names and "prepayment_type" not in names
    amort = next(f for f in data["fields"] if f["name"] == "amortization_type")
    assert "simple" in amort["choices"] and "royalty" in amort["choices"]
    assert set(data["core"]) <= names


def test_collateral_aliases_resolve(client):
    from cashflows.registry import get_collateral_class

    data = client.get("/api/schema/collateral-types").json()
    for entry in data["types"]:
        for alias in entry["aliases"]:
            assert get_collateral_class(alias).__name__ == entry["class"]


def test_step_types_round_trip_spec_names(client):
    from cashflows.liabilities.spec import _STEP_ENCODERS

    data = client.get("/api/schema/step-types").json()
    ui_types = {s["type"] for s in data["steps"]}
    assert set(_STEP_ENCODERS) | {"if"} == ui_types


def test_trigger_metrics_and_scenarios(client):
    metrics = client.get("/api/schema/trigger-metrics").json()
    assert {"cnl", "oc", "ic", "aux"} <= {m["name"] for m in metrics["metrics"]}
    scen = client.get("/api/schema/stress-scenarios").json()
    assert {"base", "severe_stress", "recession"} <= {s["name"] for s in scen["curve_scenarios"]}
    assert "cdr" in scen["multiplier_fields"]


def test_parse_value(client):
    r = client.post("/api/parse/value", json={"text": "S+180"}).json()
    assert r["ok"] and r["floating"] and abs(r["value"] - 0.018) < 1e-9
    r = client.post("/api/parse/value", json={"text": "8.5%"}).json()
    assert r["ok"] and not r["floating"] and abs(r["value"] - 0.085) < 1e-9
