# Deploying Pariksha — Vercel + Caddy

```
Browser ──HTTPS──▶ Vercel  (React app, LMS-FE/)
   │
   └──────HTTPS──▶ your server: Caddy :443 ──▶ uvicorn 127.0.0.1:7860 (FastAPI)
                                                 ├─ SQLite + uploads on local disk
                                                 └─ OpenRouter (LLM)
```

The React app is static, so Vercel hosts it. The backend keeps live tests in memory and its data on disk, so it runs on one small Linux server, with Caddy in front for HTTPS. The API needs its own subdomain: the app's page paths (`/student/…`, `/professor/…`) are the same as the API's paths.

You need:
- A server: Ubuntu 22.04 or 24.04, 2–4 GB RAM (e.g. Hetzner CX22, DigitalOcean, Lightsail).
- A domain. Below: `api.pariksha.example.edu` for the API.
- An OpenRouter API key, ideally on a paid model such as `google/gemini-2.5-flash`.
- The GitHub repo connected to Vercel.

---

## 1. Backend server (about 15 minutes)

1. **DNS:** add an **A record** for `api.pariksha.example.edu` pointing at the server's IP, and wait until `ping api.pariksha.example.edu` resolves.

2. **Run the setup script** on the server:
   ```bash
   git clone --branch DEV https://github.com/vishal152354/LMS-gurusish.git /tmp/pariksha
   sudo bash /tmp/pariksha/deploy/setup-server.sh api.pariksha.example.edu https://YOUR-APP.vercel.app DEV
   ```
   The script:
   - installs Python, Caddy and the app (to `/opt/pariksha`, run as user `pariksha`)
   - creates `.env` with a random professor password, which it **prints once**, and a random token secret
   - starts the `pariksha-api` service
   - configures Caddy, which obtains the HTTPS certificate automatically

   Use your real Vercel address as the second argument; you can change it later via `CORS_ORIGINS` in `.env`.

3. **Add your LLM key:**
   ```bash
   sudo nano /opt/pariksha/viva-webapp/.env      # set HERMES_API_KEY and HERMES_MODEL
   sudo systemctl restart pariksha-api
   ```

4. **Configure Hermes**, which the upload pipeline calls to extract concepts:
   ```bash
   sudo -u pariksha -H /opt/pariksha/viva-webapp/venv/bin/hermes setup
   ```
   Choose OpenRouter and the same key and model.

5. **Check** from your laptop: `curl https://api.pariksha.example.edu/health` should print `{"status":"ok",…}`.

## 2. Frontend on Vercel (about 5 minutes)

1. vercel.com → **Add New → Project** → import `vishal152354/LMS-gurusish`.
2. **Root Directory:** `LMS-FE`. The framework, build command and output are read from `LMS-FE/vercel.json`.
3. **Environment Variables** (Production, and Preview if you use it):
   | Name | Value |
   |---|---|
   | `VITE_API_BASE_URL` | `https://api.pariksha.example.edu` |
4. **Settings → Git → Production Branch:** `main` or `DEV`. Pushes to other branches get preview URLs.
5. **Deploy.** If the Vercel address differs from the one you passed to the setup script, update `CORS_ORIGINS` on the server (comma-separated; include any custom domain) and run `sudo systemctl restart pariksha-api`.

`vercel.json` serves `index.html` for every route (so refreshing `/professor/results` works) and caches the hashed assets for a year.

## 3. Day-to-day

| Task | Command (on the server) |
|---|---|
| Deploy new backend code | `sudo bash /opt/pariksha/deploy/update.sh` |
| Logs | `journalctl -u pariksha-api -f` |
| Restart | `sudo systemctl restart pariksha-api` |
| Nightly backup | `sudo crontab -e` → `30 2 * * * /opt/pariksha/deploy/backup.sh` (database + uploads, 14 days kept in `/var/backups/pariksha`) |

The frontend redeploys automatically on every push to the production branch.

## Before students use it

- [ ] Revoke the OpenRouter key that was public in the original repo and use a new one.
- [ ] Note the professor password the setup script printed (or set `PROFESSOR_PASSWORD` **before** the first start; it only applies when the database is created).
- [ ] `CORS_ORIGINS` lists only your frontend address(es).
- [ ] Copy the backup files somewhere other than this server.
- [ ] Don't restart the API during an exam: live tests are held in memory and would be lost.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| App shows “Cannot reach the server” | `VITE_API_BASE_URL` wrong or not set before the build: fix it in Vercel and redeploy |
| Browser console: “blocked by CORS policy” | Vercel address missing from `CORS_ORIGINS` |
| Caddy has no certificate | DNS not pointing at the server yet, or ports 80/443 blocked |
| Uploads never become Ready | Hermes not configured (step 1.4); see `journalctl -u pariksha-api` |
| Creating a test fails | LLM key missing or rate-limited; free models are slow and flaky |
