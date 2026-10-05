#!/usr/bin/env bash
# One-time setup of the Pariksha API on a fresh Ubuntu 22.04 / 24.04 server.
#
#   sudo bash setup-server.sh <api-domain> <frontend-origin> [branch]
#   e.g. sudo bash setup-server.sh api.pariksha.example.edu https://pariksha.vercel.app DEV
#
# Point the API domain's DNS A record at this server before running it, so
# Caddy can obtain the HTTPS certificate.
set -euo pipefail

API_DOMAIN="${1:?usage: setup-server.sh <api-domain> <frontend-origin> [branch]}"
FRONTEND_ORIGIN="${2:?usage: setup-server.sh <api-domain> <frontend-origin> [branch]}"
BRANCH="${3:-DEV}"
REPO="${REPO:-https://github.com/vishal152354/LMS-gurusish.git}"
APP_DIR=/opt/pariksha
APP_USER=pariksha
DATA_HOME=/var/lib/pariksha        # holds the SQLite DB (~/viva-webapp/data) and uploads (~/.hermes)

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> System packages"
apt-get update -qq
apt-get install -y -qq git python3 python3-venv python3-pip sqlite3 curl debian-keyring debian-archive-keyring apt-transport-https gnupg

echo "==> Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy
fi

echo "==> Service user"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$DATA_HOME" --shell /usr/sbin/nologin "$APP_USER"

echo "==> Code ($BRANCH)"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Python environment (a few minutes — includes the Whisper speech model libs)"
sudo -u "$APP_USER" bash -c "
  cd $APP_DIR/viva-webapp
  [ -d venv ] || python3 -m venv venv
  ./venv/bin/pip install -q --upgrade pip
  ./venv/bin/pip install -q -r requirements.txt
  ./venv/bin/pip install -q -e ../hermes-agent
"

echo "==> Configuration"
ENV_FILE="$APP_DIR/viva-webapp/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp "$APP_DIR/viva-webapp/.env.example" "$ENV_FILE"
  PROF_PASS="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  sed -i "s|^PROFESSOR_PASSWORD=.*|PROFESSOR_PASSWORD=$PROF_PASS|" "$ENV_FILE"
  sed -i "s|^TOKEN_SECRET=.*|TOKEN_SECRET=$(openssl rand -hex 32)|" "$ENV_FILE"
  {
    echo ""
    echo "CORS_ORIGINS=$FRONTEND_ORIGIN"
    echo "HERMES_BIN=$APP_DIR/viva-webapp/venv/bin/hermes"
    echo "EDGE_TTS_BIN=$APP_DIR/viva-webapp/venv/bin/edge-tts"
    echo "APP_URL=$FRONTEND_ORIGIN"
  } >> "$ENV_FILE"
  echo "    Professor login: admin / $PROF_PASS   (shown once — note it down)"
fi
chown "$APP_USER:$APP_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"

echo "==> systemd service"
install -m 644 "$HERE/pariksha-api.service" /etc/systemd/system/pariksha-api.service
systemctl daemon-reload
systemctl enable --now pariksha-api

echo "==> Caddy site"
mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
sed "s|__API_DOMAIN__|$API_DOMAIN|g" "$HERE/Caddyfile.template" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile >/dev/null
systemctl reload caddy || systemctl restart caddy

if command -v ufw >/dev/null; then ufw allow OpenSSH >/dev/null; ufw allow 80,443/tcp >/dev/null; fi

echo "==> Health check"
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:7860/health >/dev/null 2>&1 && break; sleep 2; done
curl -fsS http://127.0.0.1:7860/health && echo

cat <<MSG

Done. Remaining steps:
  1. Put your LLM key in $ENV_FILE  (HERMES_API_KEY=…), then:
       sudo systemctl restart pariksha-api
  2. Configure Hermes for the upload pipeline (uses the same OpenRouter key):
       sudo -u $APP_USER -H $APP_DIR/viva-webapp/venv/bin/hermes setup
  3. Check https://$API_DOMAIN/health from your laptop.
  4. In Vercel set VITE_API_BASE_URL=https://$API_DOMAIN and redeploy.
MSG
