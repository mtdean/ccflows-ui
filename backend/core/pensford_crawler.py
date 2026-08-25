"""
ccflows-ui/backend/core/pensford_crawler.py
The embedded Pensford crawler: a background daemon that pulls the Pensford
SOFR forward-curve XML on a schedule and keeps the workspace rate curve
'pensford-sofr' fresh, so deals on named rates always have a current curve
without anyone clicking FETCH.

Controlled by env:
  CCFLOWS_PENSFORD_AUTO            "1" (default) to run, "0" to disable
  CCFLOWS_PENSFORD_INTERVAL_HOURS  refresh cadence (default 24)

Failures never crash anything — the last error is kept for the status chip.
"""

import os
import threading
from datetime import datetime, timezone
from typing import Any

from . import rates_store

CURVE_NAME = "Pensford SOFR"
CURVE_SLUG = "pensford-sofr"

_state_lock = threading.Lock()
_state: dict[str, Any] = {
    "enabled": False,
    "running": False,
    "last_attempt": None,
    "last_success": None,
    "last_error": None,
    "interval_hours": 24.0,
}
_wake = threading.Event()
_thread: threading.Thread | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

# Pensford's rate_label -> our column names (engine-compatible: sofr_1m_term /
# sofr_3m_term / sofr_1m_isda mirror the old PensfordProvider XML parse).
_LABELS = {
    "1M Term SOFR": "sofr_1m_term",
    "3M Term SOFR": "sofr_3m_term",
    "1M ISDA SOFR": "sofr_1m_isda",
    "Daily SOFR": "sofr_daily",
    "30D Average SOFR (NYFED)": "sofr_30d_avg",
    "Prime": "prime",
}


def fetch_pensford_df():
    """One live fetch of the Pensford SOFR forward curve -> monthly frame with
    a 'date' column + decimal rate columns (sofr_1m aliases 1M Term SOFR).

    Pensford retired the old HubSpot XML file; the curve now comes from the
    site's own projection API, which wants a browser UA + the session cookie
    the forward-curve page sets. Falls back to the engine's legacy XML URL if
    the API shape changes back. Raises on failure."""
    import pandas as pd
    import requests

    # Corporate networks: requests honors REQUESTS_CA_BUNDLE for
    # TLS-intercepting proxies; CCFLOWS_PENSFORD_VERIFY=0 is the last-resort
    # escape hatch when the proxy's CA can't be exported.
    verify: bool | str = True
    if os.environ.get("CCFLOWS_PENSFORD_VERIFY", "1") == "0":
        verify = False
        import urllib3

        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    elif os.environ.get("REQUESTS_CA_BUNDLE"):
        verify = os.environ["REQUESTS_CA_BUNDLE"]

    base = "https://pensford.com"
    try:
        s = requests.Session()
        s.verify = verify
        s.headers.update({"User-Agent": _UA, "Referer": f"{base}/forward-curve"})
        s.get(f"{base}/forward-curve", timeout=30)  # establishes the session cookie
        resp = s.get(f"{base}/api/forward-curve/projection",
                     params={"table": "forward_curve"}, timeout=30)
        resp.raise_for_status()
        rows = resp.json().get("rows") or []
        if not rows:
            raise ValueError("projection API returned no rows")
        df = pd.DataFrame(rows)
        df = df[df["rate_label"].isin(_LABELS)]
        wide = (df.pivot_table(index="reset_date", columns="rate_label",
                               values="rate_value")
                  .rename(columns=_LABELS))
        wide.index = pd.to_datetime(wide.index)
        # daily 10y path -> month-start rows (deal rates frames are monthly)
        wide = wide.resample("MS").first() / 100.0
        wide["sofr_1m"] = wide["sofr_1m_term"]  # canonical engine column
        return wide.reset_index().rename(columns={"reset_date": "date",
                                                  "index": "date"})
    except Exception as primary:  # noqa: BLE001 — try the legacy XML before giving up
        from cashflows.rates.providers import PensfordProvider

        provider = PensfordProvider()
        try:
            return provider._parse(  # noqa: SLF001 — documented offline seam
                requests.get(provider.url, timeout=30, verify=verify,
                             headers={"User-Agent": _UA}).content)
        except Exception as fallback:
            raise RuntimeError(
                f"projection API: {type(primary).__name__}: {primary} | "
                f"legacy XML: {type(fallback).__name__}: {fallback}") from primary


def refresh() -> dict[str, Any]:
    """Fetch now and upsert the workspace curve. Returns the status dict."""
    with _state_lock:
        _state["last_attempt"] = _now()
    try:
        df = fetch_pensford_df()
        doc = rates_store.from_dataframe(CURVE_NAME, df, "pensford crawler")
        doc["meta"]["fetched_at"] = _now()
        rates_store.save(doc)
        with _state_lock:
            _state["last_success"] = _now()
            _state["last_error"] = None
    except Exception as exc:  # noqa: BLE001 — the crawler must never raise
        with _state_lock:
            _state["last_error"] = str(exc)
    return status()


def status() -> dict[str, Any]:
    with _state_lock:
        out = dict(_state)
    out["curve_slug"] = CURVE_SLUG
    out["curve_exists"] = rates_store.exists(CURVE_SLUG)
    if out["curve_exists"]:
        try:
            out["fetched_at"] = (rates_store.load(CURVE_SLUG).get("meta") or {}).get("fetched_at")
        except (FileNotFoundError, ValueError):
            out["fetched_at"] = None
    return out


def _loop(interval_hours: float) -> None:
    while True:
        refresh()
        if _wake.wait(timeout=interval_hours * 3600):
            _wake.clear()  # manual kick — refresh immediately


def start() -> None:
    """Start the daemon (idempotent). Called from app startup."""
    global _thread
    if os.environ.get("CCFLOWS_PENSFORD_AUTO", "1") != "1":
        return
    interval = float(os.environ.get("CCFLOWS_PENSFORD_INTERVAL_HOURS", "24") or 24)
    with _state_lock:
        if _state["running"]:
            return
        _state.update(enabled=True, running=True, interval_hours=interval)
    _thread = threading.Thread(target=_loop, args=(interval,),
                               name="pensford-crawler", daemon=True)
    _thread.start()
