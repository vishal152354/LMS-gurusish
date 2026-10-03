# AI Viva Voce System

An AI-powered oral examination system built on Hermes Agent.

## Quick Start

### Terminal 1 — Hermes Gateway (AI backend)
```bash
hermes gateway
```
Or with full path:
```bash
/home/asus/.hermes/hermes-agent/venv/bin/hermes gateway
```

### Terminal 2 — Web Application
```bash
cd ~/viva-webapp
bash start.sh
```

Then open Chrome or Edge and go to: **http://localhost:7860**

---

## Architecture

```
Student Browser
     │
     ▼
FastAPI Backend (port 7860)
     │
     ├── OKF Pipeline (extracts concepts from uploaded docs)
     ├── Knowledge Graph Builder
     ├── SQLite Database (~/viva-webapp/data/viva.db)
     └── Hermes Agent API (port 8642)
              │
              └── Ollama Cloud (gemma4:31b)
```

## File Locations

| Item | Path |
|------|------|
| Student OKF bundles | `~/.hermes/workspace/viva-sessions/` |
| Database | `~/viva-webapp/data/viva.db` |
| Uploaded files | `~/viva-webapp/data/uploads/` |
| Viva Agent skill | `~/.hermes/skills/viva-agent/SKILL.md` |
| Backend | `~/viva-webapp/backend/` |
| Frontend | `~/viva-webapp/frontend/` |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/student/join` | Student login / returning check |
| POST | `/student/upload` | Upload document |
| GET | `/student/pipeline/status/{id}` | Check OKF build progress |
| GET | `/student/uploads/{student_id}` | List all uploads |
| POST | `/student/viva/start` | Begin viva session |
| POST | `/student/viva/answer/{id}` | Submit answer |
| POST | `/student/viva/command/{id}` | Send hint/skip/quit/repeat |
| POST | `/student/viva/integrity/{id}` | Log integrity event |
| POST | `/student/viva/end/{id}` | End session |
| GET | `/student/result/{student_id}/{upload_id}` | Get result |
| POST | `/audio/tts` | Text-to-speech (returns MP3) |

## Hermes API Key
Set `HERMES_API_KEY` in `viva-webapp/.env` (see `.env.example`). Never commit real keys.

## Supported File Types
- PDF (.pdf)
- Text (.txt)
- Word Document (.docx)
- Maximum size: 20 MB

## Browser Requirements
Use **Chrome** or **Edge** for microphone support (Web Speech API).

## Marks Rubric
| Criterion | Max |
|-----------|-----|
| Knowledge of subject | 10 |
| Understanding of own work | 10 |
| Confidence and clarity | 10 |
| Presence of mind | 10 |
| Meaningful contribution | 10 |
| **Total** | **50** |

## Grade Scale
A+ (45-50) · A (40-44) · B (35-39) · C (28-34) · D (20-27) · F (0-19)
