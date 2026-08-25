"""Validation endpoints: field-mapped errors, strict percent warnings, lint."""


def test_good_repline_ok(client):
    good = {"repline_id": "r1", "upb": 1e6, "gross_wac": 0.12, "net_wac": 0.10,
            "term": 60, "cdr": [0.002] * 60, "cpr": [0.008] * 60}
    r = client.post("/api/validate/repline", json={"repline": good}).json()
    assert r["ok"] and not r["errors"]


def test_bad_repline_reports_errors(client):
    bad = {"repline_id": "r1", "upb": -5, "gross_wac": 12, "net_wac": 0.1, "term": 60}
    r = client.post("/api/validate/repline", json={"repline": bad}).json()
    assert not r["ok"]
    messages = " ".join(e["msg"] for e in r["errors"])
    assert "upb" in messages


def test_percent_curve_warns(client):
    pct = {"repline_id": "r2", "upb": 1e6, "gross_wac": 0.12, "net_wac": 0.1,
           "term": 60, "cdr": [2.0] * 60}
    r = client.post("/api/validate/repline", json={"repline": pct}).json()
    assert any("cdr" in w for w in r["warnings"])


WF = {
    "schema": "cashflows.waterfall/1", "reserve_initial": 0,
    "bonds": [
        {"type": "bond", "name": "A", "size_pct": 0.9, "coupon": 0.05},
        {"type": "residual", "name": "R"},
    ],
    "triggers": [],
    "steps": [
        {"name": "int", "type": "pay_interest", "bonds": ["A"]},
        {"name": "prin", "type": "pay_principal", "bonds": []},
        {"name": "resid", "type": "pay_residual"},
    ],
}


def test_waterfall_valid_and_mermaid(client):
    r = client.post("/api/validate/waterfall", json=WF).json()
    assert r["ok"]
    m = client.post("/api/waterfall/mermaid", json=WF).json()
    assert m["ok"] and m["mermaid"].startswith("flowchart")
    d = client.post("/api/waterfall/describe", json=WF).json()
    assert d["ok"] and len(d["text"]) > 50


def test_waterfall_missing_residual(client):
    broken = dict(WF, bonds=[WF["bonds"][0]])
    r = client.post("/api/validate/waterfall", json=broken).json()
    assert not r["ok"] and r["errors"]


def test_full_deal_doc_validates(client, deal_doc):
    r = client.post("/api/validate/deal", json=deal_doc).json()
    assert r["ok"], r["errors"]
