"""
Writes finished attempts into the reporting tables (pariksha.test_results / test_result_answers).

PostgreSQL only — those tables don't exist in the SQLite fallback. Rows are upserted, so
re-syncing an attempt (or running the backfill again) updates instead of duplicating.
Results are an archive: they stay when a test is later deleted.
"""
import json, logging

from ..database.db import IS_PG, get_conn
from . import content_library

log = logging.getLogger(__name__)

_RESULT_SQL = """
INSERT INTO pariksha.test_results
    (session_id, test_id, test_title, test_date, teacher_id, teacher_name, content_ids, content_names,
     roll_number, student_name, status, marks_obtained, max_marks, grade,
     questions_total, questions_correct, questions_wrong, questions_unanswered,
     marks_by_type, tab_switches, flagged, started_at, completed_at, synced_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, now())
ON CONFLICT (test_id, roll_number) DO UPDATE SET
    session_id = EXCLUDED.session_id, test_title = EXCLUDED.test_title, teacher_name = EXCLUDED.teacher_name,
    content_ids = EXCLUDED.content_ids, content_names = EXCLUDED.content_names,
    student_name = EXCLUDED.student_name, status = EXCLUDED.status,
    marks_obtained = EXCLUDED.marks_obtained, max_marks = EXCLUDED.max_marks, grade = EXCLUDED.grade,
    questions_total = EXCLUDED.questions_total, questions_correct = EXCLUDED.questions_correct,
    questions_wrong = EXCLUDED.questions_wrong, questions_unanswered = EXCLUDED.questions_unanswered,
    marks_by_type = EXCLUDED.marks_by_type, tab_switches = EXCLUDED.tab_switches, flagged = EXCLUDED.flagged,
    started_at = EXCLUDED.started_at, completed_at = EXCLUDED.completed_at, synced_at = now()
RETURNING result_id
"""

_ANSWER_SQL = """
INSERT INTO pariksha.test_result_answers
    (result_id, question_no, question_type, question_text, student_answer, correct_answer,
     is_correct, marks_awarded, max_marks, match_pairs)
VALUES (?,?,?,?,?,?,?,?,?,?)
"""


def _answered(q: dict) -> bool:
    return q.get("student_answer") is not None or q.get("selected_index") is not None


def sync_attempt(session_id: str) -> bool:
    """Upsert one finished attempt. Never raises — reporting must not break the test flow."""
    if not IS_PG:
        return False
    conn = get_conn()
    try:
        s = conn.execute("SELECT * FROM viva_sessions WHERE id=?", (session_id,)).fetchone()
        if not s or not s["event_id"]:
            return False
        e = conn.execute("SELECT * FROM viva_events WHERE id=?", (s["event_id"],)).fetchone()
        m = conn.execute("SELECT total, grade FROM marks WHERE session_id=? ORDER BY created_at DESC LIMIT 1",
                         (session_id,)).fetchone()
        if not e or not m:
            return False
        from ..routes.professor import _event_marks
        teacher = conn.execute("SELECT display_name FROM professors WHERE id=?", (e["professor_id"],)).fetchone()
        roster = conn.execute("SELECT name FROM event_students WHERE event_id=? AND roll_number=?",
                              (e["id"], s["student_id"])).fetchone()
        student = conn.execute("SELECT name FROM students WHERE id=?", (s["student_id"],)).fetchone()
        qlog = json.loads(s["question_log"] or "[]")

        by_type = {}
        for q in qlog:
            t = by_type.setdefault(q.get("type", "mcq"), {"obtained": 0, "max": 0})
            t["obtained"] = round(t["obtained"] + (q.get("marks_awarded") or 0), 2)
            t["max"] = round(t["max"] + (q.get("max_marks") or 0), 2)
        correct = sum(1 for q in qlog if q.get("is_correct"))
        unanswered = sum(1 for q in qlog if not q.get("is_correct") and not _answered(q))
        tabs = conn.execute("SELECT COUNT(*) FROM integrity_log WHERE session_id=?", (session_id,)).fetchone()[0]
        upload_ids = content_library.event_upload_ids(e)
        names = [n for n in content_library.content_names(conn, e).split(", ") if n]

        result_id = conn.execute(_RESULT_SQL, (
            session_id, e["id"], e["title"], e["event_date"], e["professor_id"],
            teacher["display_name"] if teacher else None, upload_ids, names,
            s["student_id"], (roster and roster["name"]) or (student and student["name"]) or s["student_id"],
            "completed", m["total"] or 0, _event_marks(e)[1], m["grade"],
            len(qlog), correct, len(qlog) - correct - unanswered, unanswered,
            json.dumps(by_type), tabs, bool(s["flagged"]), s["start_time"], s["end_time"] or s["start_time"],
        )).fetchone()[0]

        conn.execute("DELETE FROM pariksha.test_result_answers WHERE result_id=?", (result_id,))
        for i, q in enumerate(qlog, 1):
            qtype = q.get("type", "mcq")
            max_m = q.get("max_marks") or 0
            conn.execute(_ANSWER_SQL, (
                result_id, q.get("question_number") or i, qtype, q.get("question", ""),
                q.get("student_answer") if "student_answer" in q else (
                    q["options"][q["selected_index"]] if q.get("selected_index") is not None and q.get("options") else None),
                q.get("correct_answer") or q.get("correct_option") or "",
                bool(q.get("is_correct")), min(q.get("marks_awarded") or 0, max_m) if max_m else 0, max_m,
                json.dumps(q["pairs"]) if q.get("pairs") else None,
            ))
        return True
    except Exception as ex:
        log.warning("results sync failed for %s: %s", session_id, ex)
        return False
    finally:
        conn.close()


def backfill() -> int:
    """Sync every finished attempt (used once after migrating; safe to repeat)."""
    if not IS_PG:
        return 0
    conn = get_conn()
    ids = [r[0] for r in conn.execute(
        "SELECT DISTINCT s.id FROM viva_sessions s JOIN marks m ON m.session_id = s.id "
        "WHERE s.event_id IS NOT NULL AND s.event_id <> ''").fetchall()]
    conn.close()
    return sum(1 for sid in ids if sync_attempt(sid))
