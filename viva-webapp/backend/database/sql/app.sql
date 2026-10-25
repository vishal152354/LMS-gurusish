-- Pariksha application schema for PostgreSQL 13+.
-- Applied automatically on backend start when DATABASE_URL is set; safe to run more than once.
-- Column names match the original SQLite schema, so the same queries run on both.

-- ── people ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
    id            text PRIMARY KEY,
    username      text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    display_name  text NOT NULL DEFAULT 'Administrator',
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS professors (                 -- teachers
    id            text PRIMARY KEY,
    username      text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    display_name  text NOT NULL DEFAULT 'Teacher',
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS students (
    id              text PRIMARY KEY,                   -- the roll number
    roll_number     text NOT NULL UNIQUE,
    name            text NOT NULL,
    master_folder   text,
    total_uploads   integer NOT NULL DEFAULT 0,
    roster_uploaded boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── content library ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS uploads (
    id              text PRIMARY KEY,
    student_id      text,                               -- legacy student uploads
    professor_id    text,                               -- uploader (admin for library items)
    filename        text,
    display_name    text,
    upload_path     text,
    okf_bundle_path text,
    graph_path      text,
    okf_ready       boolean NOT NULL DEFAULT false,     -- knowledge graph built
    viva_completed  boolean NOT NULL DEFAULT false,
    is_library      boolean NOT NULL DEFAULT false,     -- admin content library item
    uploaded_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uploads_library_idx ON uploads (uploaded_at DESC) WHERE is_library;

-- ── tests ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS viva_events (                -- a test
    id                 text PRIMARY KEY,
    professor_id       text NOT NULL,
    upload_id          text NOT NULL,                   -- first content item (older code paths)
    upload_ids         jsonb,                           -- every content item the paper uses
    title              text NOT NULL,
    event_date         date NOT NULL,
    start_time         text NOT NULL DEFAULT '',        -- legacy slot scheduling
    end_time           text NOT NULL DEFAULT '',
    status             text NOT NULL DEFAULT 'scheduled',
    max_students       integer NOT NULL DEFAULT 10,
    num_questions      integer NOT NULL DEFAULT 10,
    marks_per_question integer NOT NULL DEFAULT 1,
    question_types     jsonb,                           -- {"mcq": n, "fill_blank": n, "match": n}
    type_marks         jsonb,                           -- marks per question of each type
    total_marks        numeric(7,2),
    questions_json     jsonb,                           -- the generated paper
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS viva_events_professor_idx ON viva_events (professor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS event_students (             -- roster
    id          text PRIMARY KEY,
    event_id    text NOT NULL,
    roll_number text NOT NULL,
    name        text,
    email       text,
    added_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_students_event_idx ON event_students (event_id);
CREATE INDEX IF NOT EXISTS event_students_roll_idx  ON event_students (roll_number);

CREATE TABLE IF NOT EXISTS event_slots (                -- legacy booking slots
    id                 text PRIMARY KEY,
    event_id           text NOT NULL,
    slot_index         integer NOT NULL,
    slot_start         text NOT NULL,
    slot_end           text NOT NULL,
    student_id         text,
    booked_at          timestamptz,
    viva_session_id    text,
    status             text NOT NULL DEFAULT 'available',
    notification_shown boolean NOT NULL DEFAULT false,
    missed_at          timestamptz
);
CREATE INDEX IF NOT EXISTS event_slots_event_idx ON event_slots (event_id, student_id);

-- ── attempts ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS viva_sessions (              -- one attempt at a test
    id                 text PRIMARY KEY,
    student_id         text,
    upload_id          text,
    event_id           text,
    slot_id            text,
    start_time         timestamptz,
    end_time           timestamptz,
    questions_asked    integer NOT NULL DEFAULT 0,
    nodes_covered      jsonb,
    question_log       jsonb,                           -- every answer, mark and explanation
    transcript_path    text,
    tab_switch_count   integer NOT NULL DEFAULT 0,
    warning_count      integer NOT NULL DEFAULT 0,
    flagged            boolean NOT NULL DEFAULT false,
    completed          boolean NOT NULL DEFAULT false,
    session_status     text NOT NULL DEFAULT 'active',
    sub_agent_id       text,
    parent_session_id  text,
    spawn_time         timestamptz,
    completion_time    timestamptz,
    notification_shown boolean NOT NULL DEFAULT false,
    missed_at          timestamptz
);
CREATE INDEX IF NOT EXISTS viva_sessions_event_idx   ON viva_sessions (event_id, student_id);
CREATE INDEX IF NOT EXISTS viva_sessions_student_idx ON viva_sessions (student_id);

CREATE TABLE IF NOT EXISTS marks (
    id               text PRIMARY KEY,
    student_id       text,
    upload_id        text,
    session_id       text,
    knowledge        numeric(6,2),
    understanding    numeric(6,2),
    confidence       numeric(6,2),
    application      numeric(6,2),
    contribution     numeric(6,2),
    total            numeric(7,2),                      -- marks obtained (partial match credit → decimals)
    grade            text,
    strong_areas     jsonb,
    areas_to_improve jsonb,
    overall_comment  text,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marks_session_idx ON marks (session_id);
CREATE INDEX IF NOT EXISTS marks_student_idx ON marks (student_id);

CREATE TABLE IF NOT EXISTS integrity_log (              -- tab switches etc.
    id         text PRIMARY KEY,
    session_id text,
    event_type text,
    timestamp  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integrity_log_session_idx ON integrity_log (session_id);

-- In-progress tests, so a backend restart doesn't lose a student's test
CREATE TABLE IF NOT EXISTS active_sessions (
    session_id text PRIMARY KEY,
    state      jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── orchestrator / notifications (legacy flows) ─────────────
CREATE TABLE IF NOT EXISTS queue (
    id           text PRIMARY KEY,
    roll_number  text NOT NULL,
    student_name text,
    student_id   text,
    event_id     text,
    upload_id    text,
    joined_at    timestamptz,
    position     integer,
    status       text NOT NULL DEFAULT 'waiting'
);

CREATE TABLE IF NOT EXISTS orchestrator_log (
    id           text PRIMARY KEY,
    event_type   text,
    roll_number  text,
    session_id   text,
    sub_agent_id text,
    timestamp    timestamptz,
    details      text
);

CREATE TABLE IF NOT EXISTS notifications (
    id           text PRIMARY KEY,
    student_id   text,
    type         text,
    triggered_at timestamptz,
    expires_at   timestamptz,
    topic        text,
    score        numeric(7,2),
    grade        text,
    slot_time    text,
    dismissed    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS notifications_student_idx ON notifications (student_id);

-- ── viva prep (flashcards + practice MCQs) ──────────────────
CREATE TABLE IF NOT EXISTS prep_sets (
    upload_id    text PRIMARY KEY,
    status       text NOT NULL DEFAULT 'pending',
    done_chunks  integer NOT NULL DEFAULT 0,
    total_chunks integer NOT NULL DEFAULT 0,
    error        text,
    updated_at   timestamptz
);

CREATE TABLE IF NOT EXISTS prep_items (
    id            text PRIMARY KEY,
    upload_id     text NOT NULL,
    kind          text NOT NULL,
    position      integer NOT NULL,
    topic         text,
    question      text NOT NULL,
    answer        text,
    explanation   text,
    options       jsonb,
    correct_index integer,
    difficulty    text,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prep_items_upload_idx ON prep_items (upload_id, kind, position);

CREATE TABLE IF NOT EXISTS prep_progress (
    student_id text NOT NULL,
    upload_id  text NOT NULL,
    kind       text NOT NULL,
    state      jsonb,
    updated_at timestamptz,
    PRIMARY KEY (student_id, upload_id, kind)
);
