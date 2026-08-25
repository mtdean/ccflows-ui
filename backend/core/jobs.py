"""
ccflows-ui/backend/core/jobs.py
Background jobs for long-running engine work (Monte Carlo, stress matrices).

Deliberately simple: an in-process ThreadPoolExecutor + dict registry, polled
by the UI. The engine's hot loops are numba/numpy which release the GIL, so
threads get real parallelism; a broker (Celery/Redis) would be operational
overkill for a local single-user tool. Jobs are lost on restart — documented.
"""

import threading
import traceback
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Callable

import config

_executor: ThreadPoolExecutor | None = None
_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    with _lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=config.JOB_MAX_WORKERS,
                                           thread_name_prefix="ccflows-job")
        return _executor


def shutdown_executor() -> None:
    global _executor
    with _lock:
        if _executor is not None:
            _executor.shutdown(wait=False, cancel_futures=True)
            _executor = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def submit(kind: str, deal_slug: str, fn: Callable[[dict[str, Any]], Any],
           params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Queue `fn(job_record)` and return the job record. `fn` may update
    job_record["progress"] as it goes; its return value becomes the result."""
    job_id = uuid.uuid4().hex[:12]
    record: dict[str, Any] = {
        "job_id": job_id, "kind": kind, "deal": deal_slug,
        "status": "queued", "progress": None, "error": None,
        "params": params or {}, "submitted": _now(), "finished": None,
        "cancel": threading.Event(), "result": None,
    }
    _jobs[job_id] = record

    def runner() -> None:
        if record["cancel"].is_set():
            record["status"] = "cancelled"
            record["finished"] = _now()
            return
        record["status"] = "running"
        try:
            record["result"] = fn(record)
            record["status"] = "cancelled" if record["cancel"].is_set() else "done"
        except Exception as exc:  # noqa: BLE001 — job errors surface via the API
            record["status"] = "error"
            record["error"] = {"type": type(exc).__name__, "message": str(exc)}
            record["traceback"] = traceback.format_exc()
        finally:
            record["finished"] = _now()

    future: Future = _get_executor().submit(runner)
    record["_future"] = future
    return record


def get(job_id: str) -> dict[str, Any] | None:
    return _jobs.get(job_id)


def list_jobs() -> list[dict[str, Any]]:
    return [public(j) for j in sorted(_jobs.values(), key=lambda j: j["submitted"], reverse=True)]


def cancel(job_id: str) -> bool:
    job = _jobs.get(job_id)
    if job is None:
        return False
    job["cancel"].set()
    future = job.get("_future")
    if future is not None and future.cancel():
        job["status"] = "cancelled"
        job["finished"] = _now()
    return True


def public(job: dict[str, Any]) -> dict[str, Any]:
    """The JSON-safe view of a job record (no futures/events/results)."""
    return {k: job[k] for k in ("job_id", "kind", "deal", "status", "progress",
                                "error", "params", "submitted", "finished")}
