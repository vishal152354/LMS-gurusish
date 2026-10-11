import os, re, csv, io, uuid, hashlib, hmac
from datetime import datetime

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

from ..database.db import get_conn, _hash
from .student import SESSIONS_ROOT

router = APIRouter(prefix="/admin", tags=["admin"])

ROLL_RE = re.compile(r"^[A-Za-z0-9/-]{1,32}$")

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
        "attempts": conn.execute("SELECT COUNT(*) FROM viva_sessions WHERE session_status='completed'").fetchone()[0],
    }
    conn.close()
    return out


# ═══════════════════════════════════════════════════════════
#  TEACHERS  (stored in the professors table)
# ═══════════════════════════════════════════════════════════

class TeacherCreate(BaseModel):
    username: str
    password: str
    display_name: str

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
            "content_count": conn.execute("SELECT COUNT(*) FROM uploads WHERE professor_id=?", (r["id"],)).fetchone()[0],
            "test_count": conn.execute("SELECT COUNT(*) FROM viva_events WHERE professor_id=?", (r["id"],)).fetchone()[0],
        })
    conn.close()
    return out


@router.post("/teachers")
async def create_teacher(token: str, req: TeacherCreate):
    _auth(token)
    username = req.username.strip()
    name = req.display_name.strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{3,32}", username):
        raise HTTPException(400, "Username must be 3–32 letters, numbers, dots, dashes or underscores.")
    if not name:
        raise HTTPException(400, "Enter the teacher's name.")
    _check_password(req.password)
    conn = get_conn()
    if conn.execute("SELECT 1 FROM professors WHERE username=?", (username,)).fetchone():
        conn.close()
        raise HTTPException(409, f"The username “{username}” is already taken.")
    tid = f"prof_{uuid.uuid4().hex[:12]}"
    now = datetime.utcnow().isoformat()
    conn.execute(
        "INSERT INTO professors (id, username, password_hash, display_name, created_at) VALUES (?,?,?,?,?)",
        (tid, username, _hash(req.password), name, now),
    )
    conn.commit()
    conn.close()
    return {"id": tid, "username": username, "display_name": name, "created_at": now,
            "content_count": 0, "test_count": 0}


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
    content = conn.execute("SELECT COUNT(*) FROM uploads WHERE professor_id=?", (teacher_id,)).fetchone()[0]
    if tests or content:
        conn.close()
        raise HTTPException(409, f"This teacher still has {tests} test(s) and {content} content file(s). "
                                 "They must delete those before the account can be removed.")
    cur = conn.execute("DELETE FROM professors WHERE id=?", (teacher_id,))
    conn.commit()
    conn.close()
    if not cur.rowcount:
        raise HTTPException(404, "Teacher not found")
    return {"ok": True}


# ═══════════════════════════════════════════════════════════
#  STUDENTS
# ═══════════════════════════════════════════════════════════

class StudentCreate(BaseModel):
    roll_number: str
    name: str


def _insert_student(conn, roll: str, name: str) -> bool:
    """Add a student; returns False if the roll number already exists."""
    if conn.execute("SELECT 1 FROM students WHERE id=?", (roll,)).fetchone():
        return False
    on_roster = conn.execute("SELECT 1 FROM event_students WHERE roll_number=?", (roll,)).fetchone()
    conn.execute(
        "INSERT INTO students (id,roll_number,name,master_folder,total_uploads,created_at,roster_uploaded) "
        "VALUES (?,?,?,?,0,?,?)",
        (roll, roll, name, str(SESSIONS_ROOT / roll), datetime.utcnow().isoformat(), 1 if on_roster else 0),
    )
    return True


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


@router.post("/students")
async def create_student(token: str, req: StudentCreate):
    _auth(token)
    roll = req.roll_number.strip().upper()
    name = req.name.strip()
    if not ROLL_RE.fullmatch(roll):
        raise HTTPException(400, "Roll number: letters, numbers, “-” or “/” only (max 32).")
    if len(name) < 2:
        raise HTTPException(400, "Enter the student's full name.")
    conn = get_conn()
    if not _insert_student(conn, roll, name):
        conn.close()
        raise HTTPException(409, f"A student with roll number {roll} already exists.")
    conn.commit()
    conn.close()
    return {"id": roll, "roll_number": roll, "name": name, "tests_taken": 0,
            "created_at": datetime.utcnow().isoformat()}


@router.post("/students/import")
async def import_students(token: str, file: UploadFile = File(...)):
    """CSV with roll_number,name columns (a header row is optional)."""
    _auth(token)
    text = (await file.read()).decode("utf-8-sig", errors="replace")
    added, skipped, invalid = 0, 0, []
    conn = get_conn()
    for i, row in enumerate(csv.reader(io.StringIO(text)), 1):
        if not row or not any(c.strip() for c in row):
            continue
        roll = row[0].strip().upper()
        name = row[1].strip() if len(row) > 1 else ""
        if i == 1 and roll.lower().replace(" ", "_") in ("roll_number", "roll", "roll_no"):
            continue                                    # header
        if not ROLL_RE.fullmatch(roll) or len(name) < 2:
            invalid.append(i)
            continue
        if _insert_student(conn, roll, name):
            added += 1
        else:
            skipped += 1
    conn.commit()
    conn.close()
    return {"added": added, "skipped": skipped, "invalid_rows": invalid[:20], "invalid_count": len(invalid)}


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
