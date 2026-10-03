#!/usr/bin/env bash
# Run the viva webapp against an OpenAI-compatible model API.
# Settings come from viva-webapp/.env (copy .env.example to .env and fill it in).
set -e
cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

# Defaults (used only when .env does not set them)
export HERMES_API_URL="${HERMES_API_URL:-https://openrouter.ai/api/v1}"
export HERMES_MODEL="${HERMES_MODEL:-google/gemini-2.5-flash}"
export HERMES_API_TIMEOUT="${HERMES_API_TIMEOUT:-75}"
# Local Ollama instead: HERMES_API_URL=http://localhost:11434/v1  HERMES_MODEL=qwen2.5:3b  HERMES_API_KEY=ollama

if [ -z "${HERMES_API_KEY:-}" ]; then
  echo "HERMES_API_KEY is not set — add it to viva-webapp/.env (see .env.example)." >&2
  exit 1
fi

echo "Model: $HERMES_MODEL via $HERMES_API_URL"
echo "App:   http://localhost:7860"

exec ./venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 7860
