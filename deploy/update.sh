#!/usr/bin/env bash
# Pull the latest code and restart the API.   sudo bash /opt/pariksha/deploy/update.sh
set -euo pipefail
APP_DIR=/opt/pariksha
sudo -u pariksha git -C "$APP_DIR" pull --ff-only
sudo -u pariksha "$APP_DIR/viva-webapp/venv/bin/pip" install -q -r "$APP_DIR/viva-webapp/requirements.txt"
install -m 644 "$APP_DIR/deploy/pariksha-api.service" /etc/systemd/system/pariksha-api.service
systemctl daemon-reload
systemctl restart pariksha-api
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:7860/health >/dev/null 2>&1 && break; sleep 2; done
curl -fsS http://127.0.0.1:7860/health && echo " — updated to $(git -C "$APP_DIR" rev-parse --short HEAD)"
