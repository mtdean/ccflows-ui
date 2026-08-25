"""
ccflows-ui/backend/api/workspaces.py
The deal-folder switcher: list known workspaces, switch the live one, add or
forget entries. The registry lives in ~/.ccflows-ui/workspaces.json (outside
any workspace). CCFLOWS_WORKSPACE pins the folder and disables switching.
"""

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException

import config
from core.serialization import clean

router = APIRouter()


def _entry(k: dict[str, Any]) -> dict[str, Any]:
    p = Path(k["path"]).expanduser()
    n_deals = len(list(p.glob("*.deal.json"))) if p.is_dir() else 0
    return {
        "name": k.get("name") or p.name,
        "path": str(p),
        "exists": p.is_dir(),
        "n_deals": n_deals,
        "active": str(p.resolve() if p.exists() else p) == str(config.WORKSPACE_DIR),
    }


@router.get("/workspaces")
def list_workspaces() -> dict[str, Any]:
    reg = config.load_registry()
    return clean({
        "active": str(config.WORKSPACE_DIR),
        "pinned": config.env_pinned(),
        "known": [_entry(k) for k in reg["known"]],
    })


@router.post("/workspaces/switch")
def switch_workspace(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """{path} -> repoint the app, build the skeleton, flush caches."""
    path = str(body.get("path") or "").strip()
    if not path:
        raise HTTPException(status_code=422, detail="path is required")
    try:
        dirs = config.switch_workspace(path)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=422,
                            detail=f"Cannot use that folder: {exc}") from exc
    return clean({"active": str(config.WORKSPACE_DIR), "dirs": dirs})


@router.post("/workspaces", status_code=201)
def add_workspace(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """{path, name?} -> remember a folder without switching to it."""
    path = str(body.get("path") or "").strip()
    if not path:
        raise HTTPException(status_code=422, detail="path is required")
    p = Path(path).expanduser()
    reg = config.load_registry()
    if any(str(Path(k["path"]).expanduser()) == str(p) for k in reg["known"]):
        raise HTTPException(status_code=409, detail="Already in the list")
    reg["known"].append({"name": str(body.get("name") or p.name), "path": str(p)})
    config.save_registry(reg)
    return clean(_entry(reg["known"][-1]))


@router.delete("/workspaces", status_code=204)
def forget_workspace(path: str) -> None:
    """Remove a folder from the list (never deletes anything on disk)."""
    p = str(Path(path).expanduser())
    if p == str(config.WORKSPACE_DIR):
        raise HTTPException(status_code=409, detail="Cannot forget the active workspace")
    if p == str(config.DEFAULT_WORKSPACE):
        raise HTTPException(status_code=409, detail="Cannot forget the default workspace")
    reg = config.load_registry()
    reg["known"] = [k for k in reg["known"]
                    if str(Path(k["path"]).expanduser()) != p]
    config.save_registry(reg)
