# Pariksha — AI Viva & Assessment Portal

Pariksha turns a course document into a ready-to-run assessment. A professor uploads a PDF or Word file, the system builds a knowledge graph from it, and an LLM writes a multiple-choice question paper for each test. Students log in with their roll number, answer by dragging the correct option into place, and see an explanation after every question. Professors get per-student results with answer breakdowns and an Excel export.

---

## Features

**For professors** (`/professor.html`)
- **Content upload** — PDF, DOCX, TXT or Markdown. The text is split into concepts and linked into a knowledge graph.
- **Test creation** — choose the content, number of questions and marks per question. The question paper is generated once, at creation time, with a live progress bar, and stored with the event so every student gets the same paper.
- **Roster upload** — CSV with `roll_number,name` (and optional `email` for invite emails).
- **Results dashboard** — status and marks for every rostered student. Click a student's name to open a donut chart of correct / wrong / unanswered answers and a question-by-question breakdown.
- **Excel export** of marks once the event has ended.
- **Live monitor** of tests in progress.

**For students** (`/` → My Tests)
- Log in with roll number and name; see every assigned test.
- **Drag-and-drop answering** — drag the correct option into the answer box (mouse, touch or pen), or tap / press A–D, then submit.
- Instant feedback card with the correct answer and an explanation after each question.
- One attempt per test, enforced per event.
- **Integrity guard** — the test runs full-screen and tab switches are logged.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Plain HTML, CSS and JavaScript (no framework, no build step) |
| Backend | Python 3.11+, **FastAPI**, served by **Uvicorn** |
| Database | SQLite (created automatically on first start) |
| Documents | `pypdf`, `python-docx` |
| LLM | Any OpenAI-compatible API — OpenRouter, a local Ollama server, or the Hermes Agent gateway |
| Speech | `faster-whisper` (local speech-to-text), `edge-tts` (text-to-speech) |
| Export | `openpyxl` |

```
Browser (HTML/JS) ──HTTP──▶ FastAPI + Uvicorn :7860 ──▶ SQLite
                                    │
                                    └──▶ LLM API (OpenRouter / Ollama / Hermes gateway)
```

---

## Repository layout

```
.
├── viva-webapp/            # the Pariksha application
│   ├── backend/
│   │   ├── main.py         # FastAPI app, page routes, static files
│   │   ├── routes/         # student, professor, viva, prep, audio, transcribe, orchestrator
│   │   ├── services/       # LLM client, content pipeline, graph builder, TTS, orchestrator
│   │   └── database/db.py  # SQLite schema and migrations
│   ├── frontend/           # HTML pages, css/, js/ (mcq-dnd.js = drag-and-drop)
│   ├── requirements.txt
│   ├── .env.example        # copy to .env and fill in
│   └── start_local.sh      # start script (macOS / Linux)
└── hermes-agent/           # Nous Research Hermes Agent (optional LLM gateway; used by the upload pipeline)
```

---

## Quick start

### 1. Install

```bash
cd viva-webapp
python3 -m venv venv
source venv/bin/activate            # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and set at least:

| Variable | Meaning |
|---|---|
| `HERMES_API_URL` | OpenAI-compatible base URL, e.g. `https://openrouter.ai/api/v1` |
| `HERMES_MODEL` | Model id, e.g. `google/gemini-2.5-flash` |
| `HERMES_API_KEY` | API key for that service |
| `PROFESSOR_USERNAME` / `PROFESSOR_PASSWORD` | Professor login, applied when the database is first created |
| `TOKEN_SECRET` | Long random string used to sign login tokens |

To run fully offline with [Ollama](https://ollama.com): `ollama pull qwen2.5:3b`, then set `HERMES_API_URL=http://localhost:11434/v1`, `HERMES_MODEL=qwen2.5:3b`, `HERMES_API_KEY=ollama`.

### 3. Run

```bash
./start_local.sh
```

Windows:

```cmd
python -m uvicorn backend.main:app --host 127.0.0.1 --port 7860
```

Open **http://localhost:7860**.

### 4. Try it

1. Sign in as **Professor** and upload a document on the *Content* tab; wait for **Ready**.
2. On *Events*, create a test — questions are generated while the progress bar runs.
3. On *Roster*, upload a CSV such as:
   ```csv
   roll_number,name
   CS2023001,Asha R
   CS2023002,Rahul K
   ```
   Keep roll numbers as text — Excel turns long numbers into scientific notation, and those rows are skipped.
4. Sign in as a **Student** with one of those roll numbers and take the test.
5. Back on *Results*, click the student's name to see their answer chart.

---

## Configuration notes

- **Data location** — the database is created at `~/viva-webapp/data/viva.db`; uploaded material and knowledge graphs are stored under `~/.hermes/workspace/viva-sessions/`.
- **Upload pipeline** — concept extraction calls the `hermes chat` CLI (from `hermes-agent/`, installed with `pip install -e hermes-agent`), so it uses the model in your Hermes config rather than `HERMES_MODEL`.
- **Microphone features** require `localhost` or HTTPS — browsers block the microphone on plain HTTP.
- **Single process** — live test sessions are held in memory, so run one Uvicorn process (no multiple workers) and avoid restarting during a test.

---

## Deployment

Run it on one server (2 GB RAM is enough) behind a reverse proxy that provides HTTPS, for example [Caddy](https://caddyserver.com):

```
pariksha.example.edu {
    reverse_proxy 127.0.0.1:7860
}
```

Keep a persistent disk for the database and uploads, and back them up regularly.

Before a real deployment:
- Set a strong `PROFESSOR_PASSWORD` and `TOKEN_SECRET`.
- Never commit `.env` — it is in `.gitignore`.
- Student login is roll number + name only; add a PIN or OTP if impersonation is a concern.
- Free LLM tiers are rate-limited; a paid model such as Gemini 2.5 Flash costs roughly $0.01–0.03 per generated test.

---

## Status

- **Viva Prep (flashcards and practice MCQs)** — backend and home page are in place (`/prep.html`); the flashcard and practice-quiz pages are still in progress.
- The spoken-viva mode (speech in, speech out) remains in the code alongside the MCQ flow.

---

## Credits

Built as an internship project — originally by [Habishake005](https://github.com/Habishake005/ai-viva-voce-system). The `hermes-agent/` directory is [Hermes Agent](https://github.com/NousResearch/Hermes-Agent) by Nous Research (MIT licence).
