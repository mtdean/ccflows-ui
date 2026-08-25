"""
ccflows-ui/backend/api/rates_curves.py
Named rate-curve management: CRUD over the workspace store plus server-side
builders (flat, month-point curve, Pensford live fetch).
"""

from typing import Any

from fastapi import APIRouter, Body, HTTPException

from core import rates_store
from core.serialization import clean

router = APIRouter()


@router.get("/rates-curves")
def get_curves() -> list[dict[str, Any]]:
    return rates_store.list_curves()


@router.get("/rates-curves/{slug}")
def get_curve(slug: str) -> dict[str, Any]:
    return rates_store.load(slug)


@router.put("/rates-curves/{slug}")
def put_curve(slug: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    body.setdefault("schema", rates_store.RATES_SCHEMA)
    return clean(rates_store.summary(rates_store.save(body)))


@router.delete("/rates-curves/{slug}", status_code=204)
def delete_curve(slug: str) -> None:
    rates_store.delete(slug)


@router.post("/rates-curves/build", status_code=201)
def build_curve(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """{name, mode: flat|points|pensford, rate?, points?: [{month, rate}], index?}"""
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name is required")
    mode = str(body.get("mode") or "flat")
    index = str(body.get("index") or "sofr_1m")

    if mode == "flat":
        from cashflows.rates.providers import FlatRatesProvider

        df = FlatRatesProvider(rate=float(body.get("rate") or 0.04)).get_rates(index_rate=index)
        source = f"flat {body.get('rate')}"
    elif mode == "points":
        from cashflows.rates.providers import CurveRatesProvider

        points = {int(p["month"]): float(p["rate"]) for p in (body.get("points") or [])}
        if not points:
            raise HTTPException(status_code=422, detail="points mode needs at least one {month, rate}")
        df = CurveRatesProvider(points).get_rates(index_rate=index)
        source = f"points curve ({len(points)} nodes)"
    elif mode == "pensford":
        try:
            from cashflows.rates.providers import PensfordProvider

            provider = PensfordProvider()
            parsed = provider._parse(  # noqa: SLF001 — parse is the documented offline seam
                __import__("requests").get(provider.url, timeout=30).content)
            df = parsed  # keep all 4 SOFR columns
            source = "pensford forward curve"
        except ImportError as exc:
            raise HTTPException(status_code=502, detail=(
                "Pensford fetch needs the 'requests' package "
                "(pip install requests)")) from exc
        except Exception as exc:  # noqa: BLE001 — network/parse failures -> clean 502
            raise HTTPException(status_code=502,
                                detail=f"Pensford fetch failed: {exc}") from exc
    else:
        raise HTTPException(status_code=422, detail=f"Unknown mode {mode!r}")

    doc = rates_store.from_dataframe(name, df, source)
    if rates_store.exists(doc["meta"]["slug"]) and not body.get("overwrite"):
        raise HTTPException(status_code=409,
                            detail=f"Curve '{doc['meta']['slug']}' exists (pass overwrite)")
    return clean(rates_store.summary(rates_store.save(doc)))
