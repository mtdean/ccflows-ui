# Run ccflows-ui on Windows: FastAPI backend serving the built frontend.
# Prereqs: Python 3.12+, Node 18+, and the ccflows engine checked out as a
# SIBLING of this repo (..\ccflows). Build the frontend first if dist/ is
# missing:  cd frontend; npm install; npm run build
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\backend")

if (-not (Test-Path ".venv")) {
    Write-Host "Creating venv + installing deps (engine from ..\..\ccflows)..."
    python -m venv .venv
    & .\.venv\Scripts\pip install -r requirements.txt
}

if (-not $env:CCFLOWS_PORT) { $env:CCFLOWS_PORT = "8020" }
Write-Host "ccflows-ui:  http://localhost:$env:CCFLOWS_PORT"

& .\.venv\Scripts\python main.py
