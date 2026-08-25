"""
ccflows-ui/backend/core/serialization.py
numpy/pandas -> JSON-safe helpers. Everything the API returns goes through
these so NaN/inf never leak into JSON (strict JSON has no NaN literal).
"""

import math
from typing import Any

import numpy as np
import pandas as pd


def clean(value: Any) -> Any:
    """Recursively convert numpy scalars/arrays to JSON-safe python values."""
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if isinstance(value, np.ndarray):
        return clean(value.tolist())
    if isinstance(value, (np.floating, float)):
        f = float(value)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, pd.Timestamp):
        return value.date().isoformat()
    return value


def df_records(df: pd.DataFrame) -> dict[str, Any]:
    """DataFrame -> {"columns": [...], "records": [...]} with order preserved."""
    out = df.reset_index() if df.index.name is not None else df
    return {
        "columns": [str(c) for c in out.columns],
        "records": clean(out.to_dict(orient="records")),
    }


def series_list(arr: Any) -> list:
    """1-D array-like -> JSON-safe list of floats/None."""
    return clean(np.asarray(arr).tolist())
