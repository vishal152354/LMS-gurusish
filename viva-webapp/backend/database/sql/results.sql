-- Pariksha results schema for PostgreSQL 13+ (gen_random_uuid() is built in).
-- Safe to run more than once:  psql -d pariksha -f deploy/postgres/results.sql

CREATE SCHEMA IF NOT EXISTS pariksha;

DO $$ BEGIN
    CREATE TYPE pariksha.attempt_status AS ENUM ('completed', 'in_progress', 'not_attempted', 'no_show');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE pariksha.question_type AS ENUM ('mcq', 'fill_blank', 'match');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One row per student per test (the portal allows one attempt per test)
CREATE TABLE IF NOT EXISTS pariksha.test_results (
    result_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id           text UNIQUE,                  -- viva_sessions.id (NULL if never started)

    -- the test
    test_id              text        NOT NULL,         -- viva_events.id
    test_title           text        NOT NULL,
    test_date            date,
    teacher_id           text        NOT NULL,         -- professors.id
    teacher_name         text,
    content_ids          text[]      NOT NULL DEFAULT '{}',   -- library items used
    content_names        text[]      NOT NULL DEFAULT '{}',

    -- the student
    roll_number          text        NOT NULL,
    student_name         text        NOT NULL,

    -- the outcome
    status               pariksha.attempt_status NOT NULL,
    marks_obtained       numeric(7,2) CHECK (marks_obtained >= 0),  -- decimals: partial credit
    max_marks            numeric(7,2) NOT NULL CHECK (max_marks > 0),
    percentage           numeric(5,2) GENERATED ALWAYS AS
                           (round(marks_obtained * 100 / max_marks, 2)) STORED,
    grade                text,                          -- e.g. Excellent / Good / Unsatisfactory
    questions_total      smallint    NOT NULL DEFAULT 0,
    questions_correct    smallint    NOT NULL DEFAULT 0,
    questions_wrong      smallint    NOT NULL DEFAULT 0,
    questions_unanswered smallint    NOT NULL DEFAULT 0,
    -- per type, e.g. {"mcq":{"obtained":4,"max":5},"match":{"obtained":2.5,"max":4}}
    marks_by_type        jsonb,

    -- integrity
    tab_switches         smallint    NOT NULL DEFAULT 0,
    flagged              boolean     NOT NULL DEFAULT false,

    -- timing
    started_at           timestamptz,
    completed_at         timestamptz,
    duration_seconds     integer GENERATED ALWAYS AS
                           (EXTRACT(EPOCH FROM (completed_at - started_at))::integer) STORED,

    synced_at            timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT one_attempt_per_test UNIQUE (test_id, roll_number),
    CONSTRAINT marks_within_max     CHECK (marks_obtained IS NULL OR marks_obtained <= max_marks),
    CONSTRAINT completed_has_marks  CHECK (status <> 'completed'
                                           OR (marks_obtained IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS test_results_test_idx      ON pariksha.test_results (test_id);
CREATE INDEX IF NOT EXISTS test_results_student_idx   ON pariksha.test_results (roll_number);
CREATE INDEX IF NOT EXISTS test_results_teacher_idx   ON pariksha.test_results (teacher_id);
CREATE INDEX IF NOT EXISTS test_results_completed_idx ON pariksha.test_results (completed_at DESC)
    WHERE status = 'completed';

-- One row per question, for answer-level analysis
CREATE TABLE IF NOT EXISTS pariksha.test_result_answers (
    result_id      uuid      NOT NULL REFERENCES pariksha.test_results (result_id) ON DELETE CASCADE,
    question_no    smallint  NOT NULL,
    question_type  pariksha.question_type NOT NULL,
    question_text  text      NOT NULL,
    student_answer text,                          -- NULL = unanswered
    correct_answer text      NOT NULL,
    is_correct     boolean   NOT NULL,
    marks_awarded  numeric(6,2) NOT NULL DEFAULT 0,
    max_marks      numeric(6,2) NOT NULL,
    match_pairs    jsonb,     -- match only: [{"left":"…","chosen":"…","correct":"…","ok":true}]
    PRIMARY KEY (result_id, question_no),
    CHECK (marks_awarded BETWEEN 0 AND max_marks)
);

-- Class averages per test (feeds dashboards / LMS gradebook reports)
CREATE OR REPLACE VIEW pariksha.test_summary AS
SELECT test_id, test_title, teacher_name,
       count(*)                                                       AS on_roster,
       count(*) FILTER (WHERE status = 'completed')                   AS completed,
       round(avg(percentage) FILTER (WHERE status = 'completed'), 1)  AS average_pct,
       max(percentage)                                                AS highest_pct,
       min(percentage) FILTER (WHERE status = 'completed')            AS lowest_pct
FROM pariksha.test_results
GROUP BY test_id, test_title, teacher_name;
