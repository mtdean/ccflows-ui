"""Shared fixtures: temp workspace/export dirs + TestClient over the app."""

import os
import sys
import tempfile
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

_tmp = tempfile.mkdtemp(prefix="ccflows-test-")
os.environ["CCFLOWS_WORKSPACE"] = str(Path(_tmp) / "workspace")
os.environ["CCFLOWS_EXPORTS"] = str(Path(_tmp) / "exports")

import config  # noqa: E402  (env must be set before this import)

config.ensure_dirs()

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402


@pytest.fixture(scope="session")
def client() -> TestClient:
    return TestClient(main.app)


@pytest.fixture()
def deal_doc():
    from core.document import new_deal

    return new_deal("Fixture Deal")


@pytest.fixture(autouse=True)
def clean_workspace():
    yield
    for path in config.WORKSPACE_DIR.glob("*.deal.json"):
        path.unlink()
