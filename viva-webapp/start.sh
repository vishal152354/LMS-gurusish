#!/usr/bin/env bash
set -e

PYTHON=${HERMES_PYTHON:-$HOME/.hermes/hermes-agent/venv/bin/python}

echo ''
echo '==================================================='
echo '  AI Viva Voce System — Starting Backend'
echo '==================================================='
echo ''
echo 'Starting FastAPI backend on http://localhost:7860 ...'
echo 'Frontend: http://localhost:7860'
echo ''
echo 'Press Ctrl+C to stop.'
echo ''

cd "$(dirname "$0")"

# Kill anything already on port 7860
fuser -k 7860/tcp 2>/dev/null && sleep 1 || true

exec $PYTHON -m uvicorn backend.main:app --host 0.0.0.0 --port 7860 --reload --reload-dir backend
