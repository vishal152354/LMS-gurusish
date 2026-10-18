import os, hashlib, hmac

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from ..database.db import get_conn, _hash
from ..services import content_library

router = APIRouter(prefix="/admin", tags=["admin"])


# ═══════════════════════════════════════════════════════════
#  AUTH  (same stateless token scheme as teachers, own namespace)
# ═══════════════════════════════════════════════════════════

def _make_token(admin_id: str, pw_hash: str) -> str:
    secret = os.getenv("TOKEN_SECRET", "viva-secret-2026")
    return hashlib.sha256(f"admin:{admin_id}:{pw_hash}:{secret}".encode()).hexdigest()

def _auth(token: str) -> dict:
    conn = get_conn()
    rows = conn.execute("SELECT * FROM admins").fetchall()
    conn.close()
    for a in rows:
        if hmac.compare_digest(token, _make_token(a["id"], a["password_hash"])):
            return dict(a)
    raise HTTPException(401, "Invalid or expired token. Please log in again.")


class LoginRequest(BaseModel):
    username: str
    password: str

@router.post("/login")
async def admin_login(req: LoginRequest):
    conn = get_conn()
    a = conn.execute("SELECT * FROM admins WHERE username=?", (req.username.strip(),)).fetchone()
    conn.close()
    if not a or not hmac.compare_digest(a["password_hash"], _hash(req.password)):
        raise HTTPException(401, "Invalid username or password")
    return {"token": _make_token(a["id"], a["password_hash"]), "admin_id": a["id"],
            "display_name": a["display_name"]}


@router.get("/me")
async def admin_me(token: str):
    a = _auth(token)
    return {"admin_id": a["id"], "username": a["username"], "display_name": a["display_name"]}


@router.get("/stats")
async def admin_stats(token: str):
    _auth(token)
    conn = get_conn()
    out = {
        "teachers": conn.execute("SELECT COUNT(*) FROM professors").fetchone()[0],
        "students": conn.execute("SELECT COUNT(*) FROM students").fetchone()[0],
        "tests":    conn.execute("SELECT COUNT(*) FROM viva_events").fetchone()[0],
        "content":  conn.execute("SELECT COUNT(*) FROM uploads WHERE is_library=1").fetchone()[0],
        "attempts": conn.execute("SELECT COUNT(*) FROM viva_sessions WHERE session_status='completed'").fetchone()[0],
    }
    conn.close()
    return out


# ═══════════════════════════════════════════════════════════
#  CONTENT LIBRARY  (admins upload; teachers build tests from it)
# ═══════════════════════════════════════════════════════════

class RenameRequest(BaseModel):
    display_name: str


@router.post("/content/upload")
async def upload_content(background_tasks: BackgroundTasks, token: str = Form(...), file: UploadFile = File(...)):
    a = _auth(token)
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "That file is empty.")
    return content_library.store_upload(a["id"], a["display_name"] or "Administrator", file.filename, raw, background_tasks)


@router.get("/content")
async def list_content(token: str):
    _auth(token)
    return content_library.list_library()


@router.patch("/content/{upload_id}")
async def rename_content(upload_id: str, req: RenameRequest, token: str):
    _auth(token)
    return content_library.rename_upload(upload_id, req.display_name)


@router.delete("/content/{upload_id}")
async def delete_content(upload_id: str, token: str):
    _auth(token)
    return content_library.delete_upload(upload_id)


# ═══════════════════════════════════════════════════════════
#  TEACHERS  (stored in the professors table; admins view, reset passwords and remove)
# ═══════════════════════════════════════════════════════════

class PasswordReset(BaseModel):
    password: str

def _check_password(pw: str):
    if len(pw) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")


@router.get("/teachers")
async def list_teachers(token: str):
    _auth(token)
    conn = get_conn()
    rows = conn.execute("SELECT id, username, display_name, created_at FROM professors ORDER BY created_at").fetchall()
    out = []
    for r in rows:
        out.append({
            "id": r["id"], "username": r["username"], "display_name": r["display_name"],
            "created_at": r["created_at"],
            "test_count": conn.execute("SELECT COUNT(*) FROM viva_events WHERE professor_id=?", (r["id"],)).fetchone()[0],
        })
    conn.close()
    return out


@router.post("/teachers/{teacher_id}/password")
async def reset_teacher_password(teacher_id: str, token: str, req: PasswordReset):
    _auth(token)
    _check_password(req.password)
    conn = get_conn()
    cur = conn.execute("UPDATE professors SET password_hash=? WHERE id=?", (_hash(req.password), teacher_id))
    conn.commit()
    conn.close()
    if not cur.rowcount:
        raise HTTPException(404, "Teacher not found")
    return {"ok": True}


@router.delete("/teachers/{teacher_id}")
async def delete_teacher(teacher_id: str, token: str):
    _auth(token)
    conn = get_conn()
    tests = conn.execute("SELECT COUNT(*) FROM viva_events WHERE professor_id=?", (teacher_id,)).fetchone()[0]
    if tests:
        conn.close()
        raise HTTPException(409, f"This teacher still has {tests} test(s). They must delete those before the account can be removed.")
    cur = conn.execute("DELETE FROM professors WHERE id=?", (teacher_id,))
    conn.commit()
    conn.close()
    if not cur.rowcount:
        raise HTTPException(404, "Teacher not found")
    return {"ok": True}


# ═══════════════════════════════════════════════════════════
#  STUDENTS  (they join themselves with roll number + name; admins only view and tidy up)
# ═══════════════════════════════════════════════════════════

@router.get("/students")
async def list_students(token: str):
    _auth(token)
    conn = get_conn()
    rows = conn.execute(
        """SELECT s.id, s.roll_number, s.name, s.created_at,
                  (SELECT COUNT(*) FROM marks m WHERE m.student_id = s.id) AS tests_taken
           FROM students s ORDER BY s.roll_number"""
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.delete("/students/{student_id}")
async def delete_student(student_id: str, token: str):
    _auth(token)
    conn = get_conn()
    taken = conn.execute("SELECT COUNT(*) FROM viva_sessions WHERE student_id=?", (student_id,)).fetchone()[0]
    if taken:
        conn.close()
        raise HTTPException(409, "This student has test attempts on record, so they can't be removed.")
    cur = conn.execute("DELETE FROM students WHERE id=?", (student_id,))
    conn.commit()
    conn.close()
    if not cur.rowcount:
        raise HTTPException(404, "Student not found")
    return {"ok": True}


# ═══════════════════════════════════════════════════════════
#  TEST RESULTS  (every teacher's tests, read-only)
# ═══════════════════════════════════════════════════════════

def _event(event_id: str):
    conn = get_conn()
    e = conn.execute("SELECT * FROM viva_events WHERE id=?", (event_id,)).fetchone()
    conn.close()
    if not e:
        raise HTTPException(404, "Test not found")
    return e


@router.get("/tests")
async def list_tests(token: str):
    from .professor import _event_marks, _types_of
    _auth(token)
    conn = get_conn()
    events = conn.execute(
        """SELECT e.*, p.display_name AS teacher_name, p.username AS teacher_username
           FROM viva_events e
           LEFT JOIN professors p ON p.id = e.professor_id
           ORDER BY e.created_at DESC"""
    ).fetchall()
    out = []
    for e in events:
        type_marks, total_marks = _event_marks(e)
        scores = [r[0] for r in conn.execute(
            """SELECT m.total FROM marks m JOIN viva_sessions s ON s.id = m.session_id
               WHERE s.event_id=? AND m.total IS NOT NULL""", (e["id"],)).fetchall()]
        avg = round(sum(scores) / len(scores) / total_marks * 100) if scores and total_marks else None
        out.append({
            "event_id": e["id"], "title": e["title"], "event_date": e["event_date"], "created_at": e["created_at"],
            "teacher_name": e["teacher_name"] or "—", "teacher_username": e["teacher_username"],
            "content_name": content_library.content_names(conn, e),
            "num_questions": e["num_questions"] or 0, "question_types": _types_of(e),
            "type_marks": type_marks, "total_marks": total_marks,
            "roster_count": conn.execute("SELECT COUNT(*) FROM event_students WHERE event_id=?", (e["id"],)).fetchone()[0],
            "completed": len(scores),
            "average_pct": avg,
        })
    conn.close()
    return out


@router.get("/tests/{event_id}/results")
async def test_results(event_id: str, token: str):
    from .professor import event_results
    _auth(token)
    return event_results(_event(event_id))


@router.get("/tests/{event_id}/export")
async def test_export(event_id: str, token: str):
    from .professor import export_event
    _auth(token)
    return export_event(_event(event_id))
