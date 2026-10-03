import json
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database.db import get_conn
from ..services import prep_service

router = APIRouter(prefix="/student/prep", tags=["prep"])

KINDS = ("flashcards", "mcq")


def _student_subjects(conn, student_id: str) -> list[dict]:
    """Uploads the student is rostered for (via any viva event), newest event first."""
    student = conn.execute("SELECT * FROM students WHERE id=?", (student_id,)).fetchone()
    if not student:
        raise HTTPException(404, "Student not found")
    rows = conn.execute("""
        SELECT ve.upload_id, ve.title, ve.event_date, u.display_name, u.filename, u.okf_ready
        FROM event_students es
        JOIN viva_events ve ON ve.id = es.event_id
        JOIN uploads u      ON u.id  = ve.upload_id
        WHERE UPPER(es.roll_number) = UPPER(?)
        ORDER BY ve.event_date DESC, ve.start_time DESC
    """, (student["roll_number"],)).fetchall()
    seen, out = set(), []
    for r in rows:
        if r["upload_id"] in seen:
            continue
        seen.add(r["upload_id"])
        name = (r["display_name"] or r["filename"] or "Viva material").rsplit(".", 1)[0]
        out.append({"upload_id": r["upload_id"], "title": name,
                    "event_title": r["title"], "okf_ready": bool(r["okf_ready"])})
    return out


def _authorize(conn, student_id: str, upload_id: str):
    if not any(s["upload_id"] == upload_id for s in _student_subjects(conn, student_id)):
        raise HTTPException(403, "This material is not part of any of your viva events")
    upload = conn.execute("SELECT * FROM uploads WHERE id=?", (upload_id,)).fetchone()
    if not upload or not upload["okf_ready"]:
        raise HTTPException(409, "The study material for this viva is still being processed")
    return upload


def _progress(conn, student_id: str, upload_id: str) -> dict:
    rows = conn.execute(
        "SELECT kind, state FROM prep_progress WHERE student_id=? AND upload_id=?",
        (student_id, upload_id),
    ).fetchall()
    out = {k: None for k in KINDS}
    for r in rows:
        try:
            out[r["kind"]] = json.loads(r["state"])
        except Exception:
            pass
    return out


@router.get("/subjects")
async def list_subjects(student_id: str):
    conn = get_conn()
    subjects = _student_subjects(conn, student_id)
    for s in subjects:
        s["status"] = prep_service.get_status(s["upload_id"])["status"]
        fcs, mcqs = prep_service.load_items(s["upload_id"]) if s["status"] == "ready" else ([], [])
        s["counts"] = {"flashcards": len(fcs), "mcq": len(mcqs)}
        s["progress"] = _progress(conn, student_id, s["upload_id"])
    conn.close()
    return subjects


@router.get("/{upload_id}")
async def get_prep(upload_id: str, student_id: str):
    """Status, content and this student's saved progress for one subject."""
    conn = get_conn()
    _authorize(conn, student_id, upload_id)
    status = prep_service.get_status(upload_id)
    flashcards, mcqs = prep_service.load_items(upload_id) if status["status"] == "ready" else ([], [])
    progress = _progress(conn, student_id, upload_id)
    conn.close()
    return {"upload_id": upload_id, **status,
            "flashcards": flashcards, "mcqs": mcqs, "progress": progress}


@router.post("/{upload_id}/generate")
async def generate(upload_id: str, student_id: str):
    conn = get_conn()
    upload = _authorize(conn, student_id, upload_id)
    conn.close()
    return prep_service.ensure_generation(upload_id, upload)


class ProgressIn(BaseModel):
    student_id: str
    state: dict


@router.put("/{upload_id}/progress/{kind}")
async def save_progress(upload_id: str, kind: str, body: ProgressIn):
    if kind not in KINDS:
        raise HTTPException(400, "Unknown prep mode")
    conn = get_conn()
    _authorize(conn, body.student_id, upload_id)
    conn.execute(
        """INSERT INTO prep_progress (student_id, upload_id, kind, state, updated_at) VALUES (?,?,?,?,?)
           ON CONFLICT(student_id, upload_id, kind) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at""",
        (body.student_id, upload_id, kind, json.dumps(body.state), datetime.utcnow().isoformat()),
    )
    conn.commit()
    conn.close()
    return {"ok": True}
