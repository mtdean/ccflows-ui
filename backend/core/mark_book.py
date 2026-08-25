"""
ccflows-ui/backend/core/mark_book.py
The workspace mark book: one shared (deal, tranche) -> {method, schedule}
mapping that portfolios and P&L resolve marks from. Schedules are step
functions keyed by month ({0: 200, 8: 250} = 200bp until month 8, then 250),
mirroring the engine's MarkSchedule.
"""

import json
import os
import threading
from datetime import datetime, timezone
from typing import Any

import config

MARKBOOK_SCHEMA = "ccflows-ui.markbook/1"
_lock = threading.Lock()


def _path():
    return config.WORKSPACE_DIR / "marks.json"


def load() -> dict[str, Any]:
    path = _path()
    if not path.is_file():
        return {"schema": MARKBOOK_SCHEMA, "meta": {"modified": None}, "entries": {}}
    return json.loads(path.read_text())


def save(doc: dict[str, Any]) -> dict[str, Any]:
    doc["schema"] = MARKBOOK_SCHEMA
    doc.setdefault("meta", {})["modified"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with _lock:
        tmp = _path().with_suffix(".json.tmp")
        tmp.write_text(json.dumps(doc, indent=1) + "\n")
        os.replace(tmp, _path())
    return doc


def _normalize_schedule(schedule: Any) -> dict[int, float]:
    out: dict[int, float] = {}
    for k, v in (schedule or {}).items():
        try:
            out[int(k)] = float(v)
        except (TypeError, ValueError):
            continue
    return out


def upsert(deal: str, tranche: str, method: str, schedule: Any,
           note: str = "") -> dict[str, Any]:
    doc = load()
    entries = doc.setdefault("entries", {})
    norm = _normalize_schedule(schedule)
    if not norm:
        entries.get(deal, {}).pop(tranche, None)
        if deal in entries and not entries[deal]:
            entries.pop(deal)
    else:
        entries.setdefault(deal, {})[tranche] = {
            "method": method if method in ("spread", "dm", "yield") else "spread",
            "schedule": {str(k): v for k, v in sorted(norm.items())},
            "note": str(note or ""),
        }
    return save(doc)


def note_for(deal: str, tranche: str) -> str:
    """The marking rationale recorded with the book entry ('' if none)."""
    entry = (load().get("entries") or {}).get(deal, {}).get(tranche)
    return str((entry or {}).get("note") or "")


def resolve(deal: str, tranche: str, month: int = 0) -> tuple[str, float] | None:
    """(method, value at month) from the book, or None if unmarked."""
    entry = (load().get("entries") or {}).get(deal, {}).get(tranche)
    if not entry:
        return None
    schedule = _normalize_schedule(entry.get("schedule"))
    if not schedule:
        return None
    applicable = [m for m in schedule if m <= month]
    key = max(applicable) if applicable else min(schedule)
    return str(entry.get("method") or "spread"), schedule[key]


def engine_schedule(deal: str, tranche: str):
    """Book entry -> engine MarkSchedule, or None."""
    entry = (load().get("entries") or {}).get(deal, {}).get(tranche)
    if not entry:
        return None
    schedule = _normalize_schedule(entry.get("schedule"))
    if not schedule:
        return None
    from cashflows import MarkSchedule

    return MarkSchedule(schedule, method=str(entry.get("method") or "spread"))
