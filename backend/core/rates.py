"""
ccflows-ui/backend/core/rates.py
Rates section -> pandas DataFrame the collateral engines consume.
"""

from typing import Any

import pandas as pd

from cashflows.horizon import DEFAULT_HORIZON


def build_rates(section: dict[str, Any] | None, run_date: str) -> pd.DataFrame:
    """Build the rates DataFrame from a deal doc `rates` section."""
    section = section or {"mode": "flat", "rate": 0.043, "index": "sofr_1m"}
    dates = pd.date_range(run_date, periods=DEFAULT_HORIZON, freq="ME")
    if section.get("mode") == "named":
        from . import rates_store

        slug = str(section.get("curve") or "")
        df = rates_store.to_dataframe(slug)
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date").sort_index()
        df = df.reindex(df.index.union(dates)).ffill().bfill().loc[dates].reset_index()
        return df.rename(columns={"index": "date"})
    if section.get("mode") == "records":
        records = section.get("records") or []
        df = pd.DataFrame.from_records(records)
        if "date" not in df.columns:
            raise ValueError("rates.records must include a 'date' column")
        df["date"] = pd.to_datetime(df["date"])
        # extend to the horizon: forward-fill the last observation
        df = df.set_index("date").sort_index()
        df = df.reindex(df.index.union(dates)).ffill().bfill().loc[dates].reset_index()
        df = df.rename(columns={"index": "date"})
        return df
    rate = float(section.get("rate", 0.043))
    index = str(section.get("index", "sofr_1m"))
    return pd.DataFrame({"date": dates, index: rate})


def rates_index(section: dict[str, Any] | None) -> str:
    if section and section.get("mode") == "named":
        return str(section.get("index") or "sofr_1m")
    if section and section.get("mode") == "records":
        records = section.get("records") or []
        if records:
            for key in records[0]:
                if key != "date":
                    return key
    return str((section or {}).get("index", "sofr_1m"))
