import sqlite3, os, hashlib
from datetime import datetime

DB_PATH = os.path.expanduser("~/viva-webapp/data/viva.db")

def get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def _add_col(conn, table, col, defn):
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    if col not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {defn}")

def _hash(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_conn()
    c = conn.cursor()

    # ── existing V1 tables ────────────────────────────────────
    c.execute("""
    CREATE TABLE IF NOT EXISTS students (
        id              TEXT PRIMARY KEY,
        roll_number     TEXT NOT NULL UNIQUE,
        name            TEXT NOT NULL,
        master_folder   TEXT,
        total_uploads   INTEGER DEFAULT 0,
        created_at      DATETIME
    )""")

    c.execute("""
    CREATE TABLE IF NOT EXISTS uploads (
        id              TEXT PRIMARY KEY,
        student_id      TEXT,
        filename        TEXT,
        upload_path     TEXT,
        okf_bundle_path TEXT,
        graph_path      TEXT,
        okf_ready       BOOLEAN DEFAULT FALSE,
        viva_completed  BOOLEAN DEFAULT FALSE,
        uploaded_at     DATETIME,
        display_name    TEXT
    )""")

    c.execute("""
    CREATE TABLE IF NOT EXISTS viva_sessions (
        id                TEXT PRIMARY KEY,
        student_id        TEXT,
        upload_id         TEXT,
        start_time        DATETIME,
        end_time          DATETIME,
        questions_asked   INTEGER DEFAULT 0,
        nodes_covered     TEXT,
        transcript_path   TEXT,
        tab_switch_count  INTEGER DEFAULT 0,
        warning_count     INTEGER DEFAULT 0,
        flagged           BOOLEAN DEFAULT FALSE,
        completed         BOOLEAN DEFAULT FALSE
    )""")

    c.execute("""
    CREATE TABLE IF NOT EXISTS marks (
        id               TEXT PRIMARY KEY,
        student_id       TEXT,
        upload_id        TEXT,
        session_id       TEXT,
        knowledge        INTEGER,
        understanding    INTEGER,
        confidence       INTEGER,
        application      INTEGER,
        contribution     INTEGER,
        total            INTEGER,
        grade            TEXT,
        strong_areas     TEXT,
        areas_to_improve TEXT,
        overall_comment  TEXT,
        created_at       DATETIME
    )""")

    c.execute("""
    CREATE TABLE IF NOT EXISTS integrity_log (
        id          TEXT PRIMARY KEY,
        session_id  TEXT,
        event_type  TEXT,
        timestamp   DATETIME
    )""")

    # ── V2 tables ─────────────────────────────────────────────

    c.execute("""
    CREATE TABLE IF NOT EXISTS professors (
        id            TEXT PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name  TEXT DEFAULT 'Professor',
        created_at    DATETIME
    )""")

    c.execute("""
    CREATE TABLE IF NOT EXISTS viva_events (
        id           TEXT PRIMARY KEY,
        professor_id TEXT NOT NULL,
        upload_id    TEXT NOT NULL,
        title        TEXT NOT NULL,
        event_date   TEXT NOT NULL,
        start_time   TEXT NOT NULL,
        end_time     TEXT NOT NULL,
        status       TEXT DEFAULT 'scheduled',
        created_at   DATETIME
    )""")

    c.execute("""
    CREATE TABLE IF NOT EXISTS event_slots (
        id              TEXT PRIMARY KEY,
        event_id        TEXT NOT NULL,
        slot_index      INTEGER NOT NULL,
        slot_start      TEXT NOT NULL,
        slot_end        TEXT NOT NULL,
        student_id      TEXT,
        booked_at       DATETIME,
        viva_session_id TEXT,
        status          TEXT DEFAULT 'available'
    )""")

    c.execute("""
    CREATE TABLE IF NOT EXISTS event_students (
        id          TEXT PRIMARY KEY,
        event_id    TEXT NOT NULL,
        roll_number TEXT NOT NULL,
        name        TEXT,
        added_at    DATETIME
    )""")

    # ── orchestrator tables ────────────────────────────────────

    c.execute("""
    CREATE TABLE IF NOT EXISTS queue (
        id           TEXT PRIMARY KEY,
        roll_number  TEXT NOT NULL,
        student_name TEXT,
        student_id   TEXT,
        event_id     TEXT,
        upload_id    TEXT,
        joined_at    DATETIME,
        position     INTEGER,
        status       TEXT DEFAULT 'waiting'
    )""")

    c.execute("""
    CREATE TABLE IF NOT EXISTS orchestrator_log (
        id           TEXT PRIMARY KEY,
        event_type   TEXT,
        roll_number  TEXT,
        session_id   TEXT,
        sub_agent_id TEXT,
        timestamp    DATETIME,
        details      TEXT
    )""")

    c.execute("""
    CREATE TABLE IF NOT EXISTS notifications (
        id           TEXT PRIMARY KEY,
        student_id   TEXT,
        type         TEXT,
        triggered_at DATETIME,
        expires_at   DATETIME,
        topic        TEXT,
        score        INTEGER,
        grade        TEXT,
        slot_time    TEXT,
        dismissed    BOOLEAN DEFAULT FALSE
    )""")

    # ── viva prep (flashcards + MCQs) ─────────────────────────

    c.execute("""
    CREATE TABLE IF NOT EXISTS prep_sets (
        upload_id    TEXT PRIMARY KEY,
        status       TEXT DEFAULT 'pending',
        done_chunks  INTEGER DEFAULT 0,
        total_chunks INTEGER DEFAULT 0,
        error        TEXT,
        updated_at   DATETIME
    )""")

    c.execute("""
    CREATE TABLE IF NOT EXISTS prep_items (
        id            TEXT PRIMARY KEY,
        upload_id     TEXT NOT NULL,
        kind          TEXT NOT NULL,
        position      INTEGER NOT NULL,
        topic         TEXT,
        question      TEXT NOT NULL,
        answer        TEXT,
        explanation   TEXT,
        options       TEXT,
        correct_index INTEGER,
        difficulty    TEXT,
        created_at    DATETIME
    )""")

    c.execute("""
    CREATE TABLE IF NOT EXISTS prep_progress (
        student_id  TEXT NOT NULL,
        upload_id   TEXT NOT NULL,
        kind        TEXT NOT NULL,
        state       TEXT,
        updated_at  DATETIME,
        PRIMARY KEY (student_id, upload_id, kind)
    )""")

    # ── migrations (add columns to existing tables) ───────────
    _add_col(conn, "uploads",       "professor_id",    "TEXT")
    _add_col(conn, "uploads",       "display_name",    "TEXT")
    conn.execute("UPDATE uploads SET display_name = filename WHERE display_name IS NULL")
    _add_col(conn, "viva_sessions", "slot_id",         "TEXT")
    _add_col(conn, "viva_sessions", "event_id",        "TEXT")
    _add_col(conn, "viva_sessions", "sub_agent_id",    "TEXT")
    _add_col(conn, "viva_sessions", "parent_session_id","TEXT")
    _add_col(conn, "viva_sessions", "spawn_time",      "DATETIME")
    _add_col(conn, "viva_sessions", "completion_time", "DATETIME")
    _add_col(conn, "viva_sessions", "session_status",  "TEXT DEFAULT 'active'")
    _add_col(conn, "viva_events",   "max_students",    "INTEGER DEFAULT 10")
    _add_col(conn, "event_students","email",           "TEXT")
    _add_col(conn, "marks",         "application",     "INTEGER")
    _add_col(conn, "students",      "roster_uploaded", "BOOLEAN DEFAULT FALSE")
    _add_col(conn, "viva_sessions", "notification_shown", "BOOLEAN DEFAULT FALSE")
    _add_col(conn, "viva_sessions", "missed_at",       "DATETIME")
    _add_col(conn, "event_slots",   "notification_shown", "BOOLEAN DEFAULT FALSE")
    _add_col(conn, "event_slots",   "missed_at",       "DATETIME")
    _add_col(conn, "viva_sessions", "question_log",    "TEXT")   # per-student MCQ answers (JSON)
    # ── MCQ test config (professor-chosen, questions pre-generated per event) ──
    _add_col(conn, "viva_events",   "num_questions",      "INTEGER DEFAULT 10")
    _add_col(conn, "viva_events",   "marks_per_question", "INTEGER DEFAULT 1")
    _add_col(conn, "viva_events",   "questions_json",     "TEXT")

    conn.commit()

    # ── default professor account ─────────────────────────────
    PROF_USER = os.getenv("PROFESSOR_USERNAME", "admin")
    PROF_PASS = os.getenv("PROFESSOR_PASSWORD", "prof1234")
    existing = conn.execute("SELECT id FROM professors WHERE username=?", (PROF_USER,)).fetchone()
    if not existing:
        conn.execute(
            "INSERT INTO professors (id, username, password_hash, display_name, created_at) VALUES (?,?,?,?,?)",
            ("prof_default", PROF_USER, _hash(PROF_PASS), "Professor", datetime.utcnow().isoformat())
        )
        conn.commit()

    conn.close()
    print(f"Database initialised at {DB_PATH}")
