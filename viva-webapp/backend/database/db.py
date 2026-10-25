"""
Database access. PostgreSQL when DATABASE_URL is set (postgresql://…), otherwise the SQLite file.

The rest of the code is written once, SQLite-style: "?" placeholders, rows read by name or
position, timestamps and JSON as strings. In PostgreSQL mode the connection wrapper below
translates placeholders and loads values back in those same shapes, so every query runs on both.
"""
import sqlite3, os, hashlib, re
from datetime import datetime
from functools import lru_cache
from pathlib import Path

DB_PATH = os.path.expanduser("~/viva-webapp/data/viva.db")
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
IS_PG = DATABASE_URL.startswith(("postgres://", "postgresql://"))
SQL_DIR = Path(__file__).parent / "sql"


def get_conn():
    if IS_PG:
        return PgConnection()
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def describe() -> str:
    if IS_PG:
        return "PostgreSQL " + re.sub(r"//[^@/]*@", "//", DATABASE_URL)   # never print the password
    return f"SQLite {DB_PATH}"


# ═══════════════════════════════════════════════════════════
#  PostgreSQL mode
# ═══════════════════════════════════════════════════════════

_pool = None


class Row:
    """A result row readable like sqlite3.Row: row["name"], row[0], row.keys(), dict(row)."""
    __slots__ = ("_values", "_index")

    def __init__(self, values, index):
        self._values = values
        self._index = index

    def __getitem__(self, key):
        if isinstance(key, str):
            return self._values[self._index[key]]
        return self._values[key]

    def keys(self):
        return list(self._index)

    def get(self, key, default=None):
        i = self._index.get(key)
        return default if i is None else self._values[i]

    def __iter__(self):
        return iter(self._values)

    def __len__(self):
        return len(self._values)

    def __repr__(self):
        return f"Row({dict(zip(self._index, self._values))})"


def _row_factory(cursor):
    index = {c.name: i for i, c in enumerate(cursor.description or [])}
    return lambda values: Row(values, index)


@lru_cache(maxsize=1024)
def _pg_sql(sql: str) -> str:
    """'?' placeholders → '%s' (outside string literals); literal '%' → '%%'."""
    out, in_str = [], False
    for ch in sql:
        if ch == "'":
            in_str = not in_str
            out.append(ch)
        elif ch == "?" and not in_str:
            out.append("%s")
        elif ch == "%":
            out.append("%%")
        else:
            out.append(ch)
    return "".join(out)


def _configure(conn):
    """Load values in the shapes the code expects from SQLite."""
    from decimal import Decimal
    from psycopg.adapt import Loader

    class TextLoader(Loader):              # json/jsonb → JSON text (callers json.loads it)
        def load(self, data):
            return bytes(data).decode()

    class TimestampLoader(Loader):         # timestamptz → naive UTC ISO string, as stored before
        def load(self, data):
            s = re.sub(r"[+-]\d\d(:\d\d)?$", "", bytes(data).decode()).replace(" ", "T", 1)
            if "." in s:                       # PostgreSQL drops trailing zeros: .90681 → .906810
                head, frac = s.split(".", 1)
                s = f"{head}.{frac.ljust(6, '0')}"
            return s

    class NumericLoader(Loader):           # numeric → int when whole, else float
        def load(self, data):
            d = Decimal(bytes(data).decode())
            return int(d) if d == d.to_integral_value() else float(d)

    for t in ("json", "jsonb", "date"):
        conn.adapters.register_loader(t, TextLoader)
    for t in ("timestamptz", "timestamp"):
        conn.adapters.register_loader(t, TimestampLoader)
    conn.adapters.register_loader("numeric", NumericLoader)


def _get_pool():
    global _pool
    if _pool is None:
        from psycopg_pool import ConnectionPool
        _pool = ConnectionPool(
            DATABASE_URL, min_size=1, max_size=int(os.getenv("DB_POOL_SIZE", "20")), timeout=15,
            kwargs={"autocommit": True, "options": "-c timezone=UTC"}, configure=_configure, open=True,
        )
    return _pool


class PgConnection:
    """Same surface the code uses on sqlite3 connections: execute(), cursor(), commit(), close().
    Statements autocommit (each one is applied as it runs); commit() is kept for compatibility."""

    def __init__(self):
        self._pool = _get_pool()
        self._conn = self._pool.getconn()

    def execute(self, sql, params=()):
        cur = self._conn.cursor(row_factory=_row_factory)
        if params:
            cur.execute(_pg_sql(sql), tuple(params))
        else:
            cur.execute(sql)
        return cur

    def executescript(self, script):
        self._conn.execute(script)

    def cursor(self):
        return self

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        if self._conn is not None:
            self._pool.putconn(self._conn)
            self._conn = None

    def __del__(self):                      # a forgotten close() still returns the connection
        try:
            self.close()
        except Exception:
            pass

def _add_col(conn, table, col, defn):
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    if col not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {defn}")

def _hash(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

def init_db():
    if IS_PG:
        conn = get_conn()
        conn.executescript((SQL_DIR / "app.sql").read_text())
        conn.executescript((SQL_DIR / "results.sql").read_text())
        _seed(conn)
        conn.close()
        print(f"Database initialised: {describe()}")
        return

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
        display_name  TEXT DEFAULT 'Teacher',
        created_at    DATETIME
    )""")

    c.execute("""
    CREATE TABLE IF NOT EXISTS admins (
        id            TEXT PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name  TEXT DEFAULT 'Administrator',
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
    _add_col(conn, "viva_sessions", "question_log",    "TEXT")   # per-student answers (JSON)
    _add_col(conn, "viva_events",   "question_types",  "TEXT")   # {"mcq": n, "fill_blank": n, "match": n}
    # ── MCQ test config (professor-chosen, questions pre-generated per event) ──
    _add_col(conn, "viva_events",   "num_questions",      "INTEGER DEFAULT 10")
    _add_col(conn, "viva_events",   "marks_per_question", "INTEGER DEFAULT 1")
    _add_col(conn, "viva_events",   "questions_json",     "TEXT")
    _add_col(conn, "viva_events",   "type_marks",         "TEXT")   # {"mcq": 1, "fill_blank": 2, "match": 4}
    _add_col(conn, "viva_events",   "total_marks",        "REAL")   # sum of every question's marks
    _add_col(conn, "viva_events",   "upload_ids",         "TEXT")   # JSON list of library items the paper uses
    _add_col(conn, "uploads",       "is_library",         "INTEGER DEFAULT 0")  # admin content library
    # Content teachers uploaded before the admin-managed library becomes library content
    conn.execute("UPDATE uploads SET is_library=1 WHERE professor_id IS NOT NULL AND student_id IS NULL AND COALESCE(is_library,0)=0")
    conn.execute("""CREATE TABLE IF NOT EXISTS active_sessions (
        session_id TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at DATETIME)""")

    conn.commit()
    _seed(conn)
    conn.close()
    print(f"Database initialised: {describe()}")


def _seed(conn):
    """Default teacher and admin accounts, and housekeeping (both databases)."""
    # saved states of tests that finished or were abandoned more than two days ago
    from datetime import timedelta
    cutoff = (datetime.utcnow() - timedelta(days=2)).isoformat()
    conn.execute("DELETE FROM active_sessions WHERE updated_at < ?", (cutoff,))

    # ── default professor account ─────────────────────────────
    PROF_USER = os.getenv("PROFESSOR_USERNAME", "admin")
    PROF_PASS = os.getenv("PROFESSOR_PASSWORD", "prof1234")
    existing = conn.execute("SELECT id FROM professors WHERE username=?", (PROF_USER,)).fetchone()
    if not existing:
        conn.execute(
            "INSERT INTO professors (id, username, password_hash, display_name, created_at) VALUES (?,?,?,?,?)",
            ("prof_default", PROF_USER, _hash(PROF_PASS), "Teacher", datetime.utcnow().isoformat())
        )
        conn.commit()
    # accounts created before "Professor" was renamed "Teacher"
    conn.execute("UPDATE professors SET display_name='Teacher' WHERE display_name='Professor'")
    conn.commit()

    # ── default admin account (creates teachers and students) ──
    ADMIN_USER = os.getenv("ADMIN_USERNAME", "superadmin")
    ADMIN_PASS = os.getenv("ADMIN_PASSWORD", "admin1234")
    if not conn.execute("SELECT id FROM admins WHERE username=?", (ADMIN_USER,)).fetchone():
        conn.execute(
            "INSERT INTO admins (id, username, password_hash, display_name, created_at) VALUES (?,?,?,?,?)",
            (f"admin_{ADMIN_USER}", ADMIN_USER, _hash(ADMIN_PASS), "Administrator", datetime.utcnow().isoformat())
        )
    elif os.getenv("ADMIN_PASSWORD"):
        # .env is the source of truth for the admin password — changing it there takes effect on restart
        conn.execute("UPDATE admins SET password_hash=? WHERE username=?", (_hash(ADMIN_PASS), ADMIN_USER))
    conn.commit()
