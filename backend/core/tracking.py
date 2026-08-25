"""
ccflows-ui/backend/core/tracking.py
The shared TrackedDeal layer: one engine TrackedDeal per deal document,
content-hash cached, with factory covenants attached and actuals ingested.
Powers monitoring, P&L, closes, sensitivities, and portfolio marks.
"""

import hashlib
import json
import threading
from collections import OrderedDict
from typing import Any

import pandas as pd

from cashflows import TrackedDeal
from cashflows.actuals.covenants import COVENANT_FACTORIES

from . import engine_bridge

_COMMON_KEYS = ("name", "severity", "grace_months", "cure_months", "description")

_lock = threading.Lock()
_cache: OrderedDict[str, tuple[str, TrackedDeal]] = OrderedDict()
_CACHE_SIZE = 8


class TrackingError(ValueError):
    """Deal cannot be tracked (mixed engines, originations, bad covenant...)."""


def build_covenants(doc: dict[str, Any]) -> list[Any]:
    """doc.covenants -> engine Covenant objects (factory-based only, JSON-safe)."""
    covenants = []
    for i, spec in enumerate(doc.get("covenants") or []):
        factory_name = str(spec.get("factory") or "")
        factory = COVENANT_FACTORIES.get(factory_name)
        if factory is None:
            raise TrackingError(
                f"covenants[{i}]: unknown factory {factory_name!r} "
                f"(known: {', '.join(sorted(COVENANT_FACTORIES))})")
        params = dict(spec.get("params") or {})
        common = {k: spec[k] for k in _COMMON_KEYS if spec.get(k) not in (None, "")}
        try:
            covenants.append(factory(**params, **common))
        except (TypeError, ValueError) as exc:
            raise TrackingError(f"covenants[{i}] ({factory_name}): {exc}") from exc
    return covenants


def _doc_hash(doc: dict[str, Any]) -> str:
    payload = json.dumps({
        "run": doc.get("run"), "waterfall": doc.get("waterfall"),
        "rates": doc.get("rates"), "actuals": doc.get("actuals"),
        "covenants": doc.get("covenants"),
    }, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def build_tracked(doc: dict[str, Any], name: str) -> TrackedDeal:
    """Fresh TrackedDeal from a deal document (no cache)."""
    if ((doc.get("run") or {}).get("originations") or {}).get("schedule"):
        raise TrackingError("Monitoring is not supported on forward-flow origination "
                            "pools yet — the vintage build-up has no stable repline ids")
    replines, _ = engine_bridge.build_replines(doc)
    engine_bridge.apply_cgl_policy(replines, doc)
    run_date = str((doc.get("run") or {}).get("run_date") or "2026-01-01")
    _, models, _ = engine_bridge.run_collateral(replines, doc.get("rates"), run_date)
    if len(models) > 1:
        raise TrackingError("Monitoring needs a single collateral engine type; "
                            "split mixed pools first")
    from cashflows.liabilities.spec import waterfall_from_dict

    wf_spec = doc.get("waterfall")
    if not wf_spec:
        raise TrackingError("Deal has no waterfall structure")
    wf = waterfall_from_dict(wf_spec)

    tracked = TrackedDeal(models[0], waterfall=wf, name=name,
                          covenants=build_covenants(doc) or None)

    actuals = doc.get("actuals") or {}
    collateral_rows = actuals.get("collateral") or []
    bond_rows = actuals.get("bonds") or []
    if collateral_rows or bond_rows:
        tracked.update(
            collateral=pd.DataFrame(collateral_rows) if collateral_rows else None,
            bonds=pd.DataFrame(bond_rows) if bond_rows else None,
        )
    return tracked


def get_tracked(slug: str, doc: dict[str, Any]) -> TrackedDeal:
    """Content-hash cached TrackedDeal for a deal document."""
    h = _doc_hash(doc)
    with _lock:
        hit = _cache.get(slug)
        if hit is not None and hit[0] == h:
            _cache.move_to_end(slug)
            return hit[1]
    tracked = build_tracked(doc, name=slug)
    with _lock:
        _cache[slug] = (h, tracked)
        _cache.move_to_end(slug)
        while len(_cache) > _CACHE_SIZE:
            _cache.popitem(last=False)
    return tracked


def has_actuals(doc: dict[str, Any]) -> bool:
    actuals = doc.get("actuals") or {}
    return bool(actuals.get("collateral") or actuals.get("bonds"))
