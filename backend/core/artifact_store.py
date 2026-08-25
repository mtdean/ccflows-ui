"""
ccflows-ui/backend/core/artifact_store.py
Saved run artifacts: named scenario runs per deal, and month-end book closes
(the FM package: every held deal's base-case run + the marks and their notes),
with the FM approval workflow on top.

Scenario runs:  workspace/scenarios/{deal}/{scenario}.json
Book closes:    workspace/book_closes/{YYYY-MM}.json
Both embed the full deal document(s) so they are self-contained: loading one
back into the editor reproduces exactly what was run.
"""

import json
import hashlib
import os
import re
import threading
from datetime import datetime, timezone
from typing import Any

import config

from . import engine_bridge, mark_book, portfolio_store, workspace

SCENARIO_SCHEMA = "ccflows-ui.scenario-run/1"
BOOKCLOSE_SCHEMA = "ccflows-ui.bookclose/1"

_lock = threading.Lock()


class ArtifactError(ValueError):
    """Maps to 422/409 at the API layer."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:64]
    if not slug:
        raise ArtifactError("Name must contain at least one letter or digit")
    return slug


def _write(path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with _lock:
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=1) + "\n")
        os.replace(tmp, path)


# --- Scenario runs ----------------------------------------------------------

def _scenario_dir(deal_slug: str):
    return config.WORKSPACE_DIR / "scenarios" / deal_slug


def save_scenario(deal_slug: str, name: str, doc: dict[str, Any],
                  scenario: str = "base",
                  custom_multipliers: dict[str, Any] | None = None,
                  macro_scenario: str | None = None,
                  price: float = 100.0, notes: str = "") -> dict[str, Any]:
    """Run the doc under the given stress and freeze doc + metrics under the
    scenario name. The engine run happens here so the artifact never depends
    on the in-memory results cache."""
    run = engine_bridge.run_deal(doc, scenario=scenario,
                                 custom_multipliers=custom_multipliers,
                                 macro_scenario=macro_scenario)
    from .serialization import clean

    metrics = engine_bridge.tranche_metrics(run.result, doc.get("waterfall") or {}, price)
    artifact = clean({
        "schema": SCENARIO_SCHEMA,
        "name": name,
        "slug": _slugify(name),
        "deal_slug": deal_slug,
        "saved_at": _now(),
        "stress": {"scenario": scenario, "custom_multipliers": custom_multipliers,
                   "macro_scenario": macro_scenario},
        "price": price,
        "notes": notes,
        "boundary_month": run.boundary_month,
        "warnings": run.warnings,
        "metrics": metrics,
        "doc": doc,
    })
    _write(_scenario_dir(deal_slug) / f"{artifact['slug']}.json", artifact)
    return artifact


def list_scenarios(deal_slug: str) -> list[dict[str, Any]]:
    out = []
    d = _scenario_dir(deal_slug)
    if d.is_dir():
        for path in sorted(d.glob("*.json")):
            try:
                a = json.loads(path.read_text())
            except (json.JSONDecodeError, OSError):
                continue
            out.append({k: a.get(k) for k in
                        ("name", "slug", "saved_at", "stress", "price", "notes",
                         "boundary_month")})
    return sorted(out, key=lambda a: a.get("saved_at") or "", reverse=True)


def load_scenario(deal_slug: str, scenario_slug: str) -> dict[str, Any]:
    path = _scenario_dir(deal_slug) / f"{scenario_slug}.json"
    if not path.is_file():
        raise FileNotFoundError(f"No scenario '{scenario_slug}' for deal '{deal_slug}'")
    return json.loads(path.read_text())


def delete_scenario(deal_slug: str, scenario_slug: str) -> None:
    path = _scenario_dir(deal_slug) / f"{scenario_slug}.json"
    if path.is_file():
        path.unlink()


# --- Book closes ------------------------------------------------------------

def _closes_dir():
    return config.WORKSPACE_DIR / "book_closes"


def _close_path(month: str):
    return _closes_dir() / f"{month}.json"


def _fingerprint(payload: Any) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def _month_key(month: str | None) -> str:
    m = str(month or datetime.now(timezone.utc).strftime("%Y-%m"))[:7]
    if not re.fullmatch(r"\d{4}-\d{2}", m):
        raise ArtifactError(f"month must be YYYY-MM, got {month!r}")
    return m


def build_book_close(month: str | None = None, notes: str = "",
                     overwrite: bool = False) -> dict[str, Any]:
    """Assemble the month-end book close: every deal held by any fund is run
    on the base case (actuals spliced in), the marks in force are recorded
    with their notes, and each fund's frozen analytics come along. The file
    is the package FM loads, validates, and approves."""
    from api.portfolios import get_analytics  # late import — avoids a cycle
    from .serialization import clean

    m = _month_key(month)
    if _close_path(m).is_file() and not overwrite:
        raise FileExistsError(f"Book close {m} already exists")

    portfolios: dict[str, Any] = {}
    held: dict[str, list[str]] = {}
    for row in portfolio_store.list_portfolios():
        pdoc = portfolio_store.load(row["slug"])
        analytics = get_analytics(row["slug"])
        portfolios[row["slug"]] = {
            "name": pdoc["meta"].get("name"),
            "positions": pdoc.get("positions") or [],
            "marks_cfg": pdoc.get("marks") or {},
            "analytics": analytics,
        }
        for p in pdoc.get("positions") or []:
            held.setdefault(p["deal"], []).append(p["tranche"])

    deals: dict[str, Any] = {}
    skipped: dict[str, str] = {}
    for deal_slug in sorted(held):
        try:
            doc = workspace.load(deal_slug)
        except FileNotFoundError:
            skipped[deal_slug] = "deal not found in workspace"
            continue
        try:
            extra_warns: list[str] = []
            try:
                run = engine_bridge.run_deal(doc)
            except ValueError as exc:
                if "Call mechanics" not in str(exc) or not (doc.get("call") or {}).get("enabled"):
                    raise
                # call + actuals: run uncalled (the portfolio analytics view
                # applies the call overlay to the cashflows separately)
                uncalled = json.loads(json.dumps(doc))
                uncalled["call"]["enabled"] = False
                run = engine_bridge.run_deal(uncalled)
                extra_warns = ["pending call not modeled in these metrics "
                               "(call+actuals runs uncalled here; fund analytics "
                               "apply the call overlay)"]
            run.warnings = list(run.warnings) + extra_warns
            price = float((doc.get("export") or {}).get("price") or 100.0)
            metrics = engine_bridge.tranche_metrics(run.result,
                                                    doc.get("waterfall") or {}, price)
            deals[deal_slug] = clean({
                "name": doc["meta"].get("name"),
                "boundary_month": run.boundary_month,
                "warnings": run.warnings,
                "metrics": metrics,
                "fingerprints": {
                    "replines": _fingerprint((doc.get("run") or {}).get("replines")),
                    "structure": _fingerprint(doc.get("waterfall")),
                },
                "doc": doc,
            })
        except Exception as exc:  # noqa: BLE001 — one bad deal shouldn't kill the close
            skipped[deal_slug] = str(exc)

    book = mark_book.load()
    marks: dict[str, Any] = {}
    for deal_slug, tranches in held.items():
        entries = (book.get("entries") or {}).get(deal_slug) or {}
        boundary = int(deals.get(deal_slug, {}).get("boundary_month") or 0)
        deal_marks: dict[str, Any] = {}
        for tranche in sorted(set(tranches)):
            entry = entries.get(tranche)
            resolved = mark_book.resolve(deal_slug, tranche, boundary)
            deal_marks[tranche] = {
                "method": (entry or {}).get("method"),
                "schedule": (entry or {}).get("schedule"),
                "note": (entry or {}).get("note") or "",
                "value_at_boundary": None if resolved is None else resolved[1],
            }
        marks[deal_slug] = {"tranches": deal_marks,
                            "fingerprint": _fingerprint(deal_marks)}

    artifact = clean({
        "schema": BOOKCLOSE_SCHEMA,
        "month": m,
        "status": "abf",
        "created_at": _now(),
        "notes": notes,
        "deals": deals,
        "skipped": skipped,
        "marks": marks,
        "portfolios": portfolios,
    })
    _write(_close_path(m), artifact)
    return artifact


def load_book_close(month: str) -> dict[str, Any]:
    path = _close_path(_month_key(month))
    if not path.is_file():
        raise FileNotFoundError(f"No book close for {month}")
    return json.loads(path.read_text())


def list_book_closes() -> list[dict[str, Any]]:
    """Close timeline, oldest first, with assumption-change flags vs the
    previous close: replines / structure / marks fingerprint diffs per deal."""
    d = _closes_dir()
    if not d.is_dir():
        return []
    closes = []
    for path in sorted(d.glob("*.json")):
        try:
            closes.append(json.loads(path.read_text()))
        except (json.JSONDecodeError, OSError):
            continue
    closes.sort(key=lambda c: c.get("month") or "")
    out = []
    prev: dict[str, Any] | None = None
    for c in closes:
        changes: dict[str, list[str]] = {"replines": [], "structure": [], "marks": []}
        if prev is not None:
            for slug, deal in (c.get("deals") or {}).items():
                before = (prev.get("deals") or {}).get(slug)
                if not before:
                    continue  # new deal — surfaced via new_deals below
                for key in ("replines", "structure"):
                    if (deal.get("fingerprints") or {}).get(key) != \
                            (before.get("fingerprints") or {}).get(key):
                        changes[key].append(slug)
            for slug, markset in (c.get("marks") or {}).items():
                before = (prev.get("marks") or {}).get(slug)
                if before and markset.get("fingerprint") != before.get("fingerprint"):
                    changes["marks"].append(slug)
        new_deals = ([] if prev is None else
                     sorted(set(c.get("deals") or {}) - set(prev.get("deals") or {})))
        out.append({
            "month": c.get("month"),
            "status": c.get("status"),
            "created_at": c.get("created_at"),
            "approved_at": c.get("approved_at"),
            "approved_by": c.get("approved_by"),
            "notes": c.get("notes"),
            "n_deals": len(c.get("deals") or {}),
            "n_skipped": len(c.get("skipped") or {}),
            "changes": changes,
            "new_deals": new_deals,
            "has_changes": any(changes.values()) or bool(new_deals),
        })
        prev = c
    return out


def approve_book_close(month: str, approver: str = "FM",
                       notes: str = "") -> dict[str, Any]:
    """FM sign-off: mark the artifact approved and force each tracked deal to
    a full engine close for its latest actual month (best-effort — a deal
    already closed or without actuals is recorded, not fatal)."""
    artifact = load_book_close(month)
    if artifact.get("status") == "fm_approved":
        raise ArtifactError(f"Book close {month} is already approved")

    from cashflows import CloseStore

    from . import tracking

    store = CloseStore(config.WORKSPACE_DIR / "closes")
    engine_closes: dict[str, str] = {}
    for deal_slug, deal in (artifact.get("deals") or {}).items():
        doc = deal.get("doc") or {}
        if not tracking.has_actuals(doc):
            engine_closes[deal_slug] = "no actuals — nothing to close"
            continue
        try:
            tracked = tracking.get_tracked(deal_slug, doc)
            snapshot = tracked.close_month(
                month=None, spreads=0.0, store=store,
                notes=f"FM book close {artifact['month']} approved by {approver}")
            engine_closes[deal_slug] = f"closed month {snapshot.month}"
        except FileExistsError:
            engine_closes[deal_slug] = "month already closed"
        except Exception as exc:  # noqa: BLE001
            engine_closes[deal_slug] = f"close failed: {exc}"

    artifact["status"] = "fm_approved"
    artifact["approved_at"] = _now()
    artifact["approved_by"] = approver
    if notes:
        artifact["approval_notes"] = notes
    artifact["engine_closes"] = engine_closes
    _write(_close_path(artifact["month"]), artifact)
    return artifact


def delete_book_close(month: str, force: bool = False) -> None:
    artifact = load_book_close(month)
    if artifact.get("status") == "fm_approved" and not force:
        raise ArtifactError(f"Book close {month} is FM-approved — pass force to delete")
    _close_path(artifact["month"]).unlink()


def approved_mark_index() -> dict[tuple[str, str], dict[str, Any]]:
    """(deal, tranche) -> latest FM-approved close carrying a mark for it.
    The portfolio view's 'good through' date."""
    d = _closes_dir()
    if not d.is_dir():
        return {}
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for path in sorted(d.glob("*.json")):  # ascending months — later wins
        try:
            c = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if c.get("status") != "fm_approved":
            continue
        for deal_slug, markset in (c.get("marks") or {}).items():
            for tranche in (markset.get("tranches") or {}):
                index[(deal_slug, tranche)] = {
                    "month": c.get("month"),
                    "approved_at": c.get("approved_at"),
                    "approved_by": c.get("approved_by"),
                }
    return index


def latest_approved() -> dict[str, Any] | None:
    """The most recent FM-approved book close, or None."""
    d = _closes_dir()
    if not d.is_dir():
        return None
    latest = None
    for path in sorted(d.glob("*.json")):
        try:
            c = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if c.get("status") == "fm_approved":
            latest = c
    return latest
