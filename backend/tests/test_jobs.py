"""Background jobs: Monte Carlo determinism, stress matrix, lifecycle."""

import time


def wait_done(client, job_id, timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = client.get(f"/api/jobs/{job_id}").json()
        if status["status"] in ("done", "error", "cancelled"):
            return status
        time.sleep(0.2)
    raise TimeoutError(job_id)


def test_monte_carlo_deterministic(client, deal_doc):
    body = {"doc": deal_doc, "n_sims": 25, "seed": 1,
            "samplers": [{"field": "cdr", "type": "lognormal", "sigma": 0.3}]}

    def run_once():
        job = client.post("/api/deals/fixture-deal/jobs/monte-carlo", json=body).json()
        status = wait_done(client, job["job_id"])
        assert status["status"] == "done", status
        return client.get(f"/api/jobs/{job['job_id']}/result").json()

    a, b = run_once(), run_once()
    assert a["summary"]["records"] == b["summary"]["records"]
    assert a["var"] == b["var"]
    assert len(a["percentile_paths"]["p50"]) == 361


def test_monte_carlo_requires_samplers(client, deal_doc):
    r = client.post("/api/deals/fixture-deal/jobs/monte-carlo",
                    json={"doc": deal_doc, "n_sims": 10, "samplers": []})
    assert r.status_code == 422


def test_stress_matrix_grid(client, deal_doc):
    job = client.post("/api/deals/fixture-deal/jobs/stress-matrix",
                      json={"doc": deal_doc, "cdr_multipliers": [1, 2],
                            "cpr_multipliers": [1], "metric": "wal"}).json()
    status = wait_done(client, job["job_id"])
    assert status["status"] == "done"
    result = client.get(f"/api/jobs/{job['job_id']}/result").json()
    assert len(result["cells"]) == 2
    assert all(c["value"] is not None for c in result["cells"])


def test_job_error_surfaces(client, deal_doc):
    bad = {"doc": deal_doc, "n_sims": 5,
           "samplers": [{"field": "not_a_field", "type": "lognormal"}]}
    job = client.post("/api/deals/fixture-deal/jobs/monte-carlo", json=bad).json()
    status = wait_done(client, job["job_id"])
    assert status["status"] == "error"
    assert client.get(f"/api/jobs/{job['job_id']}/result").status_code == 422


def test_unknown_job_404(client):
    assert client.get("/api/jobs/nope").status_code == 404
