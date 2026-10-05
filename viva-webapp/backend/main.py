import os, subprocess, asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from .database.db import init_db
from .routes.student      import router as student_router
from .routes.viva         import router as viva_router
from .routes.audio        import router as audio_router
from .routes.transcribe   import router as transcribe_router
from .routes.professor    import router as professor_router
from .routes.orchestrator import router as orchestrator_router
from .routes.prep         import router as prep_router

app = FastAPI(title="Pariksha", version="1.0.0")

# Comma-separated list of allowed frontend origins, e.g.
#   CORS_ORIGINS=https://pariksha.vercel.app,https://pariksha.yourcollege.in
# Unset (local development) allows any origin.
_cors = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    init_db()
    print("Pariksha started")
    # Start Hermes API gateway if not already running
    asyncio.create_task(_ensure_hermes_gateway())

async def _ensure_hermes_gateway():
    import urllib.request, urllib.error
    # Skip when the app is pointed at another OpenAI-compatible server (e.g. local Ollama)
    if ":8642" not in os.getenv("HERMES_API_URL", "http://localhost:8642/v1"):
        print(f"Using model API at {os.getenv('HERMES_API_URL')} — not starting Hermes gateway")
        return
    hermes_url = "http://localhost:8642/v1/models"
    hermes_key = os.getenv("HERMES_API_KEY", "")
    try:
        req = urllib.request.Request(hermes_url, headers={"Authorization": f"Bearer {hermes_key}"})
        urllib.request.urlopen(req, timeout=3)
        print("Hermes API gateway already running on port 8642")
        return
    except Exception:
        pass
    # Start it
    hermes_bin = os.getenv("HERMES_BIN", os.path.expanduser("~/.local/bin/hermes"))
    subprocess.Popen(
        [hermes_bin, "gateway", "run", "--replace"],
        env=os.environ.copy(),
        stdout=open("/tmp/hermes_gateway.log", "w"),
        stderr=subprocess.STDOUT,
    )
    # Wait up to 15s for it to come up
    for _ in range(15):
        await asyncio.sleep(1)
        try:
            req = urllib.request.Request(hermes_url, headers={"Authorization": f"Bearer {hermes_key}"})
            urllib.request.urlopen(req, timeout=2)
            print("Hermes API gateway started on port 8642")
            return
        except Exception:
            pass
    print("WARNING: Hermes API gateway did not start — will fall back to subprocess mode")

app.include_router(student_router)
app.include_router(viva_router)
app.include_router(audio_router)
app.include_router(transcribe_router)
app.include_router(professor_router)
app.include_router(orchestrator_router)
app.include_router(prep_router)

@app.post("/system/check-no-shows")
async def check_no_shows():
    from .routes.student import run_no_show_checks
    count = run_no_show_checks()
    return {"ok": True, "no_shows_detected": count}

@app.get("/health")
async def health():
    return {"status": "ok", "service": "viva-backend"}

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

if os.path.isdir(FRONTEND_DIR):
    # Mount static assets (css, js)
    app.mount("/css", StaticFiles(directory=os.path.join(FRONTEND_DIR, "css")), name="css")
    app.mount("/js",  StaticFiles(directory=os.path.join(FRONTEND_DIR, "js")),  name="js")

    def _html(name: str):
        path = os.path.join(FRONTEND_DIR, f"{name}.html")
        resp = FileResponse(path, media_type="text/html")
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"]        = "no-cache"
        resp.headers["Expires"]       = "0"
        return resp

    @app.get("/")
    async def serve_index():
        return _html("index")

    @app.get("/upload")
    async def serve_upload():
        return _html("upload")

    @app.get("/progress")
    async def serve_progress():
        return _html("progress")

    @app.get("/viva")
    async def serve_viva():
        return _html("viva")

    @app.get("/complete")
    async def serve_complete():
        return _html("complete")

    @app.get("/student-dashboard")
    async def serve_student_dashboard():
        return _html("student_dashboard")

    @app.get("/queue")
    async def serve_queue():
        return _html("queue")

    @app.get("/slots")
    async def serve_slots():
        return _html("slots")

    # Also serve raw .html filenames for direct navigation
    @app.get("/{page}.html")
    async def serve_html_page(page: str):
        allowed = ["index", "upload", "progress", "viva", "complete", "professor", "student_dashboard", "queue", "slots", "prep", "flashcards", "mcq", "tests"]
        if page in allowed:
            return _html(page)
        from fastapi import HTTPException
        raise HTTPException(404)
