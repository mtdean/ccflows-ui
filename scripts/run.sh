#!/bin/bash
# Run ccflows-ui: FastAPI backend serving the built frontend on :8000.
# Build the frontend first if dist/ is missing or stale:
#   cd frontend && npm run build
set -euo pipefail
cd "$(dirname "$0")/../backend"

if [ ! -d .venv ]; then
  echo "Creating venv + installing deps…"
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi

PORT="${CCFLOWS_PORT:-8020}"
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || echo "")
echo "ccflows-ui:  http://localhost:$PORT"
[ -n "$LAN_IP" ] && echo "LAN:         http://$LAN_IP:$PORT"

exec .venv/bin/python main.py
