"""
ccflows-ui/backend/core/results_store.py
In-memory LRU of run results. WaterfallResult/CollateralCashflows hold large
numpy arrays and are cheap to regenerate, so eviction -> 410 and the UI
re-runs. Lost on restart by design.
"""

import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import config


@dataclass
class RunRecord:
    run_id: str
    deal_slug: str
    scenario: str
    price: float
    result: Any            # WaterfallResult
    collateral: Any        # summed CollateralCashflows
    waterfall_spec: dict
    models: list[Any] = field(default_factory=list)   # per-engine-group instances
    waterfall_obj: Any = None                         # built Waterfall (re-runnable)
    warnings: list[str] = field(default_factory=list)
    is_portfolio: bool = False                        # forward-flow vintage build-up
    boundary_month: int | None = None                 # actuals splice boundary
    reinvestment: dict[str, Any] | None = None        # reinvest/call run extras
    created: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds"))


_lock = threading.Lock()
_store: OrderedDict[str, RunRecord] = OrderedDict()


def put(record: RunRecord) -> str:
    with _lock:
        _store[record.run_id] = record
        _store.move_to_end(record.run_id)
        while len(_store) > config.RESULTS_CACHE_SIZE:
            _store.popitem(last=False)
    return record.run_id


def get(run_id: str) -> RunRecord | None:
    with _lock:
        record = _store.get(run_id)
        if record is not None:
            _store.move_to_end(run_id)
        return record


def new_id() -> str:
    return uuid.uuid4().hex[:12]
