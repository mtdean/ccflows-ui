"""
ccflows-ui/backend/api/errors.py
Map engine exceptions to structured 422 responses the form UI can attach to
fields: {"detail": {"errors": [{"loc": [...], "field": ..., "msg": ..., "hint": ...}]}}.
"""

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from cashflows.validation import ValidationError

from core.document import DocumentError

logger = logging.getLogger(__name__)


def error_payload(msg: str, loc: list | None = None, field: str | None = None,
                  hint: str | None = None) -> dict:
    return {"errors": [{"loc": loc or [], "field": field, "msg": msg, "hint": hint}]}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ValidationError)
    async def _validation_error(request: Request, exc: ValidationError):
        return JSONResponse(status_code=422, content={
            "detail": error_payload(str(exc), field=exc.field, hint=exc.hint),
        })

    @app.exception_handler(DocumentError)
    async def _document_error(request: Request, exc: DocumentError):
        return JSONResponse(status_code=422, content={
            "detail": error_payload(str(exc), loc=list(exc.loc)),
        })

    @app.exception_handler(FileNotFoundError)
    async def _not_found(request: Request, exc: FileNotFoundError):
        return JSONResponse(status_code=404, content={"detail": f"Not found: {exc}"})

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        corr = uuid.uuid4().hex[:8]
        logger.exception("Unhandled error %s on %s", corr, request.url.path)
        return JSONResponse(status_code=500, content={
            "detail": f"Internal error ({type(exc).__name__}) — correlation {corr}",
        })


def engine_error_msg(exc: Exception) -> dict:
    """Curated messages for well-known engine TypeErrors/ValueErrors."""
    msg = str(exc)
    hint = None
    if isinstance(exc, TypeError) and "callable" in msg:
        hint = ("Callable trigger metrics/thresholds are behavior, not data. Use a "
                "built-in metric (cnl, anl, oc, ic, pool_factor, excess_spread, month, aux) "
                "or a stepped threshold schedule instead.")
    return {"msg": msg, "hint": hint}
