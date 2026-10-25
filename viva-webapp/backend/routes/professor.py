import os, re, json, csv, io, uuid, hashlib, hmac, smtplib, logging
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..database.db import get_conn
from ..services.hermes_client import hermes_client
from ..services import question_gen, content_library

router = APIRouter(prefix="/professor", tags=["professor"])


PROFESSOR_PIN = os.getenv("PROFESSOR_PIN", "prof1234")   # kept for backward-compat

# ═══════════════════════════════════════════════════════════
#  AUTH  (username + password, stateless token)
# ═══════════════════════════════════════════════════════════

def _hash(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

def _make_token(professor_id: str, pw_hash: str) -> str:
    secret = os.getenv("TOKEN_SECRET", "viva-secret-2026")
    return hashlib.sha256(f"{professor_id}:{pw_hash}:{secret}".encode()).hexdigest()

def _professor_by_token(token: str) -> Optional[dict]:
    conn = get_conn()
    rows = conn.execute("SELECT * FROM professors").fetchall()
    conn.close()
    for p in rows:
        if hmac.compare_digest(token, _make_token(p["id"], p["password_hash"])):
            return dict(p)
    return None

def _auth(token: str) -> dict:
    prof = _professor_by_token(token)
    if not prof:
        raise HTTPException(401, "Invalid or expired token. Please log in again.")
    return prof


class LoginRequest(BaseModel):
    username: str
    password: str

@router.post("/login")
async def professor_login(req: LoginRequest):
    conn = get_conn()
    prof = conn.execute(
        "SELECT * FROM professors WHERE username=?", (req.username.strip(),)
    ).fetchone()
    conn.close()
    if not prof or not hmac.compare_digest(prof["password_hash"], _hash(req.password)):
        raise HTTPException(401, "Invalid username or password")
    token = _make_token(prof["id"], prof["password_hash"])
    return {"token": token, "professor_id": prof["id"], "display_name": prof["display_name"]}


@router.get("/me")
async def professor_me(token: str):
    prof = _auth(token)
    return {"professor_id": prof["id"], "username": prof["username"], "display_name": prof["display_name"]}


# ═══════════════════════════════════════════════════════════
#  CONTENT  (the admin's library; read-only for teachers)
# ═══════════════════════════════════════════════════════════

CONTENT_MANAGED = "Content is managed by your admin. Choose from the content library when you create a test."


@router.post("/content/upload")
async def upload_content(token: str = Form(...), file: UploadFile = File(None)):
    _auth(token)
    raise HTTPException(403, CONTENT_MANAGED)


@router.get("/content")
async def list_content(token: str):
    """The content library the admin has uploaded (read-only for teachers)."""
    _auth(token)
    return content_library.list_library()


# ═══════════════════════════════════════════════════════════
#  EVENTS + SLOTS
# ═══════════════════════════════════════════════════════════

# Live progress of question generation, keyed by a client-chosen progress_id.
# In-memory is enough: it only lives for the duration of one create request.
_event_progress: dict = {}

def _set_event_progress(pid, stage, attempt=0, **extra):
    if not pid:
        return
    _event_progress[pid] = {"stage": stage, "attempt": attempt,
                            "updated": datetime.utcnow().timestamp(), **extra}
    # drop entries older than 10 minutes
    cutoff = datetime.utcnow().timestamp() - 600
    for k in [k for k, v in _event_progress.items() if v["updated"] < cutoff]:
        _event_progress.pop(k, None)


@router.get("/events/progress/{progress_id}")
async def event_progress(progress_id: str, token: str):
    _auth(token)
    return _event_progress.get(progress_id) or {"stage": "pending", "attempt": 0}


class CreateEventRequest(BaseModel):
    progress_id:        Optional[str] = None   # lets the UI poll generation progress
    upload_ids:         Optional[list] = None  # library items to build the paper from
    upload_id:          Optional[str] = None   # legacy: a single item
    title:              str
    num_questions:      int = 10   # legacy: MCQs only, used when question_types is absent
    # how many of each type, e.g. {"mcq": 5, "fill_blank": 3, "match": 2}
    question_types:     Optional[dict] = None
    marks_per_question: int = 1    # legacy: one value for every question
    # marks per question of each type, e.g. {"mcq": 1, "fill_blank": 2, "match": 4}
    # (a match question's marks are shared across its pairs)
    type_marks:         Optional[dict] = None
    event_date:         Optional[str] = None   # legacy (slots) — unused in the roster model
    start_time:         Optional[str] = None
    end_time:           Optional[str] = None
    max_students:       int = 50


@router.post("/events")
async def create_event(token: str, req: CreateEventRequest):
    prof = _auth(token)

    if req.question_types:
        counts = {t: max(0, min(30, int(req.question_types.get(t, 0) or 0))) for t in question_gen.TYPES}
    else:
        counts = {"mcq": max(1, min(50, req.num_questions)), "fill_blank": 0, "match": 0}
    if not 1 <= sum(counts.values()) <= 50:
        raise HTTPException(400, "Choose between 1 and 50 questions in total.")
    marks_per_question = max(1, min(100, req.marks_per_question))
    type_marks = {t: max(1, min(100, int((req.type_marks or {}).get(t) or marks_per_question)))
                  for t in question_gen.TYPES}
    pid = req.progress_id
    _set_event_progress(pid, "reading")

    upload_ids = list(dict.fromkeys([u for u in (req.upload_ids or ([req.upload_id] if req.upload_id else [])) if u]))
    if not upload_ids:
        raise HTTPException(400, "Choose at least one content item.")
    if len(upload_ids) > 10:
        raise HTTPException(400, "Choose at most 10 content items.")

    conn = get_conn()
    try:
        uploads = content_library.library_uploads(conn, upload_ids)
    except HTTPException:
        conn.close()
        raise
    pending = [u["display_name"] or u["filename"] for u in uploads if not u["okf_ready"]]
    if pending:
        conn.close()
        raise HTTPException(400, f"Still processing: {', '.join(pending)}. Please wait until it's ready.")

    # Merge the chosen items' knowledge graphs, and give each an equal share of the source text
    from ..services.prep_service import _load_source_text
    graph, sources = {"nodes": [], "edges": []}, []
    share = question_gen.SOURCE_CHARS // len(uploads)
    for u in uploads:
        g = None
        if u["graph_path"] and Path(u["graph_path"]).exists():
            try:
                g = json.load(open(u["graph_path"]))
            except Exception:
                g = None
        if g and g.get("nodes"):
            graph["nodes"] += g.get("nodes", [])
            graph["edges"] += g.get("edges", [])
        summary = ""
        if u["graph_path"]:
            sp = Path(u["graph_path"]).parent / "knowledge-graph-summary.md"
            if sp.exists():
                summary = sp.read_text()
        # The concept notes are the best source; the summary also holds outline text
        # (node ids, "suggested viva path") that leads to questions about the document.
        text = (_load_source_text(dict(u)) or summary or "").strip()
        if text:
            title = u["display_name"] or u["filename"]
            sources.append(f"=== {title} ===\n{text[:share]}" if len(uploads) > 1 else text[:share])
    if not graph["nodes"]:
        conn.close()
        _set_event_progress(pid, "failed")
        raise HTTPException(500, "Knowledge graph missing for this content; cannot build questions.")
    source = "\n\n".join(sources)

    # Steer away from questions already used in earlier tests on any of these items
    earlier = []
    for r in conn.execute("SELECT upload_id, upload_ids, questions_json FROM viva_events WHERE questions_json IS NOT NULL").fetchall():
        if set(content_library.event_upload_ids(r)) & set(upload_ids):
            try:
                earlier.extend(json.loads(r["questions_json"]))
            except Exception:
                pass
    questions = await question_gen.generate_paper(
        hermes_client, graph, source, counts,
        on_progress=lambda stage, info: _set_event_progress(pid, stage, 0, **info),
        avoid=earlier, stats=(gen_stats := {}),
    )
    if not questions:
        _set_event_progress(pid, "failed")
        conn.close()
        raise HTTPException(502, "Could not generate questions from this content. Please try again.")

    _set_event_progress(pid, "saving")
    for q in questions:
        q["marks"] = type_marks[question_gen.qtype(q)]
    total_marks = question_gen.paper_total(questions)
    made = {t: sum(1 for q in questions if question_gen.qtype(q) == t) for t in question_gen.TYPES}
    event_id     = str(uuid.uuid4())
    now          = datetime.utcnow().isoformat()
    max_students = max(1, min(200, req.max_students))

    conn.execute(
        """INSERT INTO viva_events
           (id,professor_id,upload_id,title,event_date,start_time,end_time,status,max_students,
            num_questions,marks_per_question,questions_json,question_types,type_marks,total_marks,upload_ids,created_at)
           VALUES (?,?,?,?,?,?,?,'scheduled',?,?,?,?,?,?,?,?,?)""",
        (event_id, prof["id"], upload_ids[0], req.title,
         req.event_date or now[:10], req.start_time or "", req.end_time or "", max_students,
         len(questions), marks_per_question, json.dumps(questions), json.dumps(made),
         json.dumps(type_marks), total_marks, json.dumps(upload_ids), now),
    )
    conn.commit()
    conn.close()
    _set_event_progress(pid, "done", generated=len(questions))
    return {
        "event_id":           event_id,
        "num_questions":      len(questions),
        "question_types":     made,
        "requested":          counts,
        "marks_per_question": marks_per_question,
        "type_marks":         type_marks,
        "total_marks":        total_marks,
        # questions that overlap an earlier test on this content (only used when no fresh ones were left)
        "reused_from_earlier": gen_stats.get("reused_from_earlier", 0),
    }


def _event_marks(e) -> tuple[dict, float]:
    """(marks per question of each type, paper total) — older events use one value for all."""
    keys = e.keys()
    mpq = (e["marks_per_question"] if "marks_per_question" in keys and e["marks_per_question"] else 1)
    tm = None
    try:
        if "type_marks" in keys and e["type_marks"]:
            tm = json.loads(e["type_marks"])
    except Exception:
        tm = None
    tm = tm or {t: mpq for t in question_gen.TYPES}
    if "total_marks" in keys and e["total_marks"] is not None:
        total = e["total_marks"]
    else:
        n = e["num_questions"] if "num_questions" in keys and e["num_questions"] else 10
        total = n * mpq
    if total == int(total):
        total = int(total)
    return tm, total


def _types_of(e) -> dict:
    """Question-type counts for an event (older events are all MCQ)."""
    try:
        if "question_types" in e.keys() and e["question_types"]:
            return json.loads(e["question_types"])
    except Exception:
        pass
    n = e["num_questions"] if "num_questions" in e.keys() and e["num_questions"] else 10
    return {"mcq": n, "fill_blank": 0, "match": 0}


@router.get("/events")
async def list_events(token: str):
    prof = _auth(token)
    conn = get_conn()
    events = conn.execute(
        "SELECT * FROM viva_events WHERE professor_id=? ORDER BY event_date DESC, start_time DESC, created_at DESC",
        (prof["id"],)
    ).fetchall()
    out = []
    for e in events:
        roster_count = conn.execute(
            "SELECT COUNT(*) FROM event_students WHERE event_id=?", (e["id"],)
        ).fetchone()[0]
        done = conn.execute(
            "SELECT COUNT(*) FROM viva_sessions WHERE event_id=? AND session_status='completed'",
            (e["id"],)
        ).fetchone()[0]

        out.append({
            "event_id":     e["id"],
            "title":        e["title"],
            "upload_id":    e["upload_id"],
            "content_name": content_library.content_names(conn, e),
            "upload_ids":   content_library.event_upload_ids(e),
            "event_date":   e["event_date"],
            "start_time":   e["start_time"],
            "end_time":     e["end_time"],
            "status":       e["status"],
            "max_students": e["max_students"] if "max_students" in e.keys() else 10,
            "num_questions":      e["num_questions"] if "num_questions" in e.keys() and e["num_questions"] else 10,
            "question_types":     _types_of(e),
            "marks_per_question": e["marks_per_question"] if "marks_per_question" in e.keys() and e["marks_per_question"] else 1,
            "type_marks":   _event_marks(e)[0],
            "total_marks":  _event_marks(e)[1],
            "roster_count": roster_count,
            "completed":    done,
            "created_at":   e["created_at"],
        })
    conn.close()
    return out


@router.get("/events/{event_id}")
async def get_event(event_id: str, token: str):
    prof = _auth(token)
    conn = get_conn()
    event = conn.execute(
        "SELECT * FROM viva_events WHERE id=? AND professor_id=?",
        (event_id, prof["id"])
    ).fetchone()
    if not event:
        conn.close()
        raise HTTPException(404, "Event not found")

    slots = conn.execute(
        """SELECT es.*, s.name AS student_name, s.roll_number
           FROM event_slots es
           LEFT JOIN students s ON s.id = es.student_id
           WHERE es.event_id=? ORDER BY es.slot_index""",
        (event_id,)
    ).fetchall()

    roster = conn.execute(
        "SELECT * FROM event_students WHERE event_id=? ORDER BY roll_number",
        (event_id,)
    ).fetchall()

    conn.close()
    return {
        "event_id":   event["id"],
        "title":      event["title"],
        "event_date": event["event_date"],
        "start_time": event["start_time"],
        "end_time":   event["end_time"],
        "status":     event["status"],
        "upload_id":  event["upload_id"],
        "slots":      [dict(s) for s in slots],
        "roster":     [dict(r) for r in roster],
    }


@router.delete("/events/{event_id}")
async def delete_event(event_id: str, token: str):
    prof = _auth(token)
    conn = get_conn()
    event = conn.execute(
        "SELECT * FROM viva_events WHERE id=? AND professor_id=?", (event_id, prof["id"])
    ).fetchone()
    if not event:
        conn.close()
        raise HTTPException(404, "Event not found")
    # The test's attempts go with it (marks, integrity log, sessions), as the UI warns
    sessions = "SELECT id FROM viva_sessions WHERE event_id=?"
    conn.execute(f"DELETE FROM marks         WHERE session_id IN ({sessions})", (event_id,))
    conn.execute(f"DELETE FROM integrity_log WHERE session_id IN ({sessions})", (event_id,))
    conn.execute("DELETE FROM viva_sessions  WHERE event_id=?", (event_id,))
    conn.execute("DELETE FROM queue          WHERE event_id=?", (event_id,))
    conn.execute("DELETE FROM event_slots    WHERE event_id=?", (event_id,))
    conn.execute("DELETE FROM event_students WHERE event_id=?", (event_id,))
    conn.execute("DELETE FROM viva_events    WHERE id=?",       (event_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════
#  EMAIL HELPER
# ═══════════════════════════════════════════════════════════

def _send_viva_notifications(event: dict, students: list[dict]):
    """Send viva invite emails to students who have an email address in the roster."""
    smtp_host = os.getenv("EMAIL_SMTP_HOST", "")
    smtp_port = int(os.getenv("EMAIL_SMTP_PORT", "587"))
    sender    = os.getenv("EMAIL_ADDRESS", "")
    password  = os.getenv("EMAIL_PASSWORD", "")
    app_url   = os.getenv("APP_URL", "http://localhost:7860")

    if not (smtp_host and sender and password):
        log.info("Email not configured — skipping notifications (set EMAIL_SMTP_HOST, EMAIL_ADDRESS, EMAIL_PASSWORD in .env)")
        return

    date_str  = event.get("event_date", "")
    start_str = event.get("start_time", "")
    end_str   = event.get("end_time",   "")
    title     = event.get("title",      "Viva Examination")

    sent, failed = 0, 0
    try:
        server = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
        server.starttls()
        server.login(sender, password)

        for s in students:
            try:
                msg = MIMEMultipart("alternative")
                msg["Subject"] = f"[Viva] You are scheduled: {title}"
                msg["From"]    = sender
                msg["To"]      = s["email"]

                body_html = f"""
<html><body style="font-family:Arial,sans-serif;color:#222;max-width:560px;margin:auto">
  <h2 style="color:#1e40af">Viva Examination Scheduled</h2>
  <p>Dear <strong>{s['name']}</strong> (Roll No: <strong>{s['roll']}</strong>),</p>
  <p>You have been scheduled for the following viva examination:</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0">
    <tr><td style="padding:8px;font-weight:bold;background:#f0f4ff;border:1px solid #c7d2fe">Event</td>
        <td style="padding:8px;border:1px solid #c7d2fe">{title}</td></tr>
    <tr><td style="padding:8px;font-weight:bold;background:#f0f4ff;border:1px solid #c7d2fe">Date</td>
        <td style="padding:8px;border:1px solid #c7d2fe">{date_str}</td></tr>
    <tr><td style="padding:8px;font-weight:bold;background:#f0f4ff;border:1px solid #c7d2fe">Time</td>
        <td style="padding:8px;border:1px solid #c7d2fe">{start_str} – {end_str}</td></tr>
    <tr><td style="padding:8px;font-weight:bold;background:#f0f4ff;border:1px solid #c7d2fe">Roll No.</td>
        <td style="padding:8px;border:1px solid #c7d2fe">{s['roll']}</td></tr>
  </table>
  <p>Click the link below to join your viva during the scheduled time:</p>
  <p style="text-align:center;margin:24px 0">
    <a href="{app_url}" style="background:#1e40af;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold">Join Viva →</a>
  </p>
  <p style="color:#666;font-size:13px">Enter your roll number <strong>{s['roll']}</strong> and your name when prompted.<br>
  Make sure you join during the scheduled time window.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="color:#999;font-size:12px">This is an automated message from the Pariksha.</p>
</body></html>"""

                msg.attach(MIMEText(body_html, "html"))
                server.sendmail(sender, s["email"], msg.as_string())
                sent += 1
            except Exception as exc:
                log.warning("Failed to send to %s: %s", s["email"], exc)
                failed += 1

        server.quit()
    except Exception as exc:
        log.error("SMTP connection failed: %s", exc)

    log.info("Viva notifications: %d sent, %d failed", sent, failed)


# ═══════════════════════════════════════════════════════════
#  STUDENT ROSTER
# ═══════════════════════════════════════════════════════════

@router.post("/events/{event_id}/roster")
async def upload_roster(
    event_id: str,
    token: str = Form(...),
    file: UploadFile = File(...),
):
    prof = _auth(token)
    conn = get_conn()
    event = conn.execute(
        "SELECT * FROM viva_events WHERE id=? AND professor_id=?", (event_id, prof["id"])
    ).fetchone()
    if not event:
        conn.close()
        raise HTTPException(404, "Event not found")

    raw  = await file.read()
    text = raw.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    now  = datetime.utcnow().isoformat()

    conn.execute("DELETE FROM event_students WHERE event_id=?", (event_id,))
    students_to_notify = []
    sci_notation_rows = []
    added = 0
    for row_num, row in enumerate(reader, start=2):
        roll = (row.get("roll_number") or row.get("Roll Number") or
                row.get("Roll") or row.get("roll") or "").strip().upper()
        name = (row.get("name") or row.get("Name") or "").strip()
        email = ""  # No email collected
        if not roll:
            continue
        # Detect scientific notation (Excel converts long numbers like 202312345678 → 7.15523E+11)
        if re.match(r'^[\d.]+E[+\-]\d+$', roll, re.IGNORECASE):
            sci_notation_rows.append(f"Row {row_num}: '{roll}' (name: {name or 'unknown'})")
            continue
        conn.execute(
            "INSERT INTO event_students (id,event_id,roll_number,name,email,added_at) VALUES (?,?,?,?,?,?)",
            (str(uuid.uuid4()), event_id, roll, name, email, now),
        )
        added += 1
        if email:
            students_to_notify.append({"roll": roll, "name": name, "email": email})

    conn.commit()

    # Fetch event details for the notification email
    event_info = conn.execute("SELECT * FROM viva_events WHERE id=?", (event_id,)).fetchone()
    conn.close()

    # Send email notifications in background (best-effort, never blocks)
    # Email notifications disabled
    # if students_to_notify and event_info:
    #     _send_viva_notifications(dict(event_info), students_to_notify)

    result = {"added": added, "notified": len(students_to_notify)}
    if sci_notation_rows:
        result["warning"] = (
            "Some roll numbers were skipped because Excel converted them to scientific notation "
            f"(e.g. 202312345678 → 7.15523E+11), which loses digits. "
            "To fix: in Excel/Google Sheets, format the roll_number column as 'Text' (not General/Number) "
            "before saving as CSV. Skipped rows: " + "; ".join(sci_notation_rows)
        )
        result["skipped"] = len(sci_notation_rows)
    return result


# ═══════════════════════════════════════════════════════════
#  EXCEL / CSV EXPORT
# ═══════════════════════════════════════════════════════════

def _owned_event(event_id: str, prof: dict):
    conn = get_conn()
    event = conn.execute(
        "SELECT * FROM viva_events WHERE id=? AND professor_id=?", (event_id, prof["id"])
    ).fetchone()
    conn.close()
    if not event:
        raise HTTPException(404, "Event not found")
    return event


@router.get("/events/{event_id}/results")
async def get_event_results(event_id: str, token: str):
    """Return all roster students with statuses and marks for a teacher's event."""
    return event_results(_owned_event(event_id, _auth(token)))


def event_results(event) -> dict:
    """Roster students with statuses and marks — shared by the teacher and admin views."""
    # Run no show checks first to update database status
    from .student import run_no_show_checks, _local_now
    run_no_show_checks()

    event_id = event["id"]
    conn = get_conn()
    rows = conn.execute("""
        SELECT es.roll_number, es.name AS student_name,
               slots.id AS slot_id, slots.slot_start, slots.slot_end, 
               COALESCE(slots.status, 'not_booked') AS slot_status,
               vs.id AS session_id, vs.session_status, vs.completed, vs.question_log,
               m.knowledge, m.understanding, m.application, m.total, m.grade, m.overall_comment
        FROM event_students es
        LEFT JOIN event_slots slots ON slots.event_id = es.event_id AND slots.student_id = es.roll_number
        LEFT JOIN viva_sessions vs ON (vs.slot_id = slots.id) OR (vs.event_id = es.event_id AND vs.student_id = es.roll_number)
        LEFT JOIN marks m ON m.session_id = vs.id
        WHERE es.event_id = ?
    """, (event_id,)).fetchall()
    conn.close()

    results_map = {}
    now_dt = _local_now()
    
    for r in rows:
        roll = r["roll_number"]
        name = r["student_name"]
        status = "Not Booked"
        k, u, a, tot, gr = "-", "-", "-", "-", "-"
        slot_str = "—"
        
        if r["slot_start"] and r["slot_end"]:
            slot_str = f"{r['slot_start']}–{r['slot_end']}"
            
        slot_status = r["slot_status"]
        
        is_passed = False
        if r["slot_start"] and r["slot_end"]:
            try:
                start_str = f"{event['event_date']} {r['slot_start']}"
                end_str = f"{event['event_date']} {r['slot_end']}"
                dt_start = datetime.strptime(start_str, "%Y-%m-%d %H:%M")
                dt_end = datetime.strptime(end_str, "%Y-%m-%d %H:%M")
                if dt_end <= dt_start:
                    dt_end += timedelta(days=1)
                if now_dt > dt_end:
                    is_passed = True
            except:
                pass
                
        if r["total"] is not None or r["completed"] == 1 or r["session_status"] == "completed" or slot_status == "completed":
            status = "Completed"
            k = r["knowledge"] if r["knowledge"] is not None else 0
            u = r["understanding"] if r["understanding"] is not None else 0
            a = r["application"] if r["application"] is not None else 0
            tot = r["total"] if r["total"] is not None else 0
            gr = r["grade"] if r["grade"] else "F"
        elif is_passed:
            status = "No Show"
            k, u, a, tot, gr = 0, 0, 0, 0, "Absent"
        elif r["session_status"] == "active" or slot_status == "in_progress":
            status = "In Progress"
            k, u, a, tot, gr = "-", "-", "-", "Live", "-"
        elif slot_status == "no_show":
            status = "No Show"
            k, u, a, tot, gr = 0, 0, 0, 0, "Absent"
        elif slot_status == "booked":
            status = "Pending"
        else:
            status = "Not Attempted"

        _ekeys = event.keys()
        _nq   = (event["num_questions"] if "num_questions" in _ekeys and event["num_questions"] else 10)
        _mpq  = (event["marks_per_question"] if "marks_per_question" in _ekeys and event["marks_per_question"] else 1)
        max_marks = _event_marks(event)[1]

        # Answer breakdown for the per-student chart
        breakdown = None
        if status == "Completed":
            try:
                qlog = json.loads(r["question_log"] or "[]")
            except Exception:
                qlog = []
            if qlog:
                def _chosen(q):
                    if "student_answer" in q:          # current log format, any question type
                        return q.get("student_answer")
                    if q.get("selected_index") is not None and q.get("options"):
                        return q["options"][q["selected_index"]]
                    return None
                correct_n    = sum(1 for q in qlog if q.get("is_correct"))
                unanswered_n = sum(1 for q in qlog if not q.get("is_correct") and _chosen(q) is None)
                breakdown = {
                    "correct": correct_n,
                    "wrong": len(qlog) - correct_n - unanswered_n,
                    "unanswered": unanswered_n,
                    "questions": [{
                        "number":   q.get("question_number"),
                        "type":     q.get("type", "mcq"),
                        "question": q.get("question", ""),
                        "chosen":   _chosen(q),
                        "correct_option": q.get("correct_answer") or q.get("correct_option", ""),
                        "is_correct": bool(q.get("is_correct")),
                        "marks_awarded": q.get("marks_awarded"),
                        "max_marks": q.get("max_marks"),
                        "pairs":    q.get("pairs"),
                    } for q in qlog],
                }
            elif isinstance(tot, (int, float)):
                # Older attempts saved only the score — derive the counts from it
                correct_n = int(tot) // max(1, _mpq)
                breakdown = {"correct": correct_n, "wrong": max(0, _nq - correct_n),
                             "unanswered": 0, "questions": None}

        row_data = {
            "breakdown": breakdown,
            "roll_number": roll,
            "student_name": name,
            "topic": event["title"],
            "slot": slot_str,
            "status": status,
            "knowledge": k,
            "understanding": u,
            "application": a,
            "total": tot,            # marks obtained (MCQ) — out of max_marks below
            "max_marks": max_marks,
            "grade": gr
        }

        status_priority = {
            "Completed": 4,
            "In Progress": 3,
            "Pending": 2,
            "No Show": 1,
            "Not Booked": 0,
            "Not Attempted": 0
        }
        
        if roll not in results_map:
            results_map[roll] = row_data
        else:
            existing = results_map[roll]
            if status_priority[status] > status_priority[existing["status"]]:
                results_map[roll] = row_data
                
    return {
        "event_id": event_id,
        "title":    event["title"],
        "results":  list(results_map.values()),
    }


@router.get("/events/{event_id}/export")
async def export_marks(event_id: str, token: str):
    return export_event(_owned_event(event_id, _auth(token)))


def export_event(event):
    """Excel (or CSV fallback) of an event's results — shared by the teacher and admin views."""
    # Run no show checks first to update database status
    from .student import run_no_show_checks, _local_now
    run_no_show_checks()

    event_id = event["id"]
    conn = get_conn()
    rows = conn.execute("""
        SELECT es.roll_number, es.name AS student_name,
               slots.id AS slot_id, slots.slot_start, slots.slot_end, 
               COALESCE(slots.status, 'not_booked') AS slot_status,
               vs.id AS session_id, vs.session_status, vs.completed, vs.completion_time,
               m.knowledge, m.understanding, m.application, m.total, m.grade, m.overall_comment
        FROM event_students es
        LEFT JOIN event_slots slots ON slots.event_id = es.event_id AND slots.student_id = es.roll_number
        LEFT JOIN viva_sessions vs ON (vs.slot_id = slots.id) OR (vs.event_id = es.event_id AND vs.student_id = es.roll_number)
        LEFT JOIN marks m ON m.session_id = vs.id
        WHERE es.event_id = ?
    """, (event_id,)).fetchall()
    conn.close()

    results_map = {}
    now_dt = _local_now()
    
    for r in rows:
        roll = r["roll_number"]
        name = r["student_name"]
        status = "Not Booked"
        k, u, a, tot, gr = 0, 0, 0, 0, "F"
        remarks = "No slot booked"
        time_slot = "—"
        
        if r["slot_start"] and r["slot_end"]:
            time_slot = f"{r['slot_start']}–{r['slot_end']}"
            
        slot_status = r["slot_status"]
        
        is_passed = False
        if r["slot_start"] and r["slot_end"]:
            try:
                start_str = f"{event['event_date']} {r['slot_start']}"
                end_str = f"{event['event_date']} {r['slot_end']}"
                dt_start = datetime.strptime(start_str, "%Y-%m-%d %H:%M")
                dt_end = datetime.strptime(end_str, "%Y-%m-%d %H:%M")
                if dt_end <= dt_start:
                    dt_end += timedelta(days=1)
                if now_dt > dt_end:
                    is_passed = True
            except:
                pass
                
        if r["total"] is not None or r["completed"] == 1 or r["session_status"] == "completed" or slot_status == "completed":
            status = "Completed"
            k = r["knowledge"] if r["knowledge"] is not None else 0
            u = r["understanding"] if r["understanding"] is not None else 0
            a = r["application"] if r["application"] is not None else 0
            tot = r["total"] if r["total"] is not None else 0
            gr = r["grade"] if r["grade"] else "F"
            comp_time = r["completion_time"] or "completed time"
            if "T" in comp_time:
                comp_time = comp_time.replace("T", " ").split(".")[0]
            remarks = f"Viva completed on {comp_time}"
        elif is_passed:
            status = "Absent - No Show"
            k, u, a, tot, gr = 0, 0, 0, 0, "F"
            remarks = f"Booked slot {r['slot_start']}-{r['slot_end']} but did not attend/complete"
        elif r["session_status"] == "active" or slot_status == "in_progress":
            status = "Pending"
            k, u, a, tot, gr = "-", "-", "-", "-", "-"
            remarks = "Viva in progress (live)"
        elif slot_status == "no_show":
            status = "Absent - No Show"
            k, u, a, tot, gr = 0, 0, 0, 0, "F"
            remarks = f"Booked slot {r['slot_start']}-{r['slot_end']} but did not attend"
        elif slot_status == "booked":
            status = "Pending"
            k, u, a, tot, gr = "-", "-", "-", "-", "-"
            remarks = f"Slot scheduled for {event['event_date']} {r['slot_start']}"
            
        row_data = {
            "roll_number": roll,
            "name": name,
            "topic": event["title"],
            "slot_date": event["event_date"],
            "slot_time": time_slot,
            "status": status,
            "knowledge": k,
            "understanding": u,
            "application": a,
            "total": tot,
            "grade": gr,
            "remarks": remarks
        }
        
        status_priority = {
            "Completed": 4,
            "Pending": 3,
            "Absent - No Show": 2,
            "Not Booked": 1
        }
        
        if roll not in results_map:
            results_map[roll] = row_data
        else:
            existing = results_map[roll]
            if status_priority[status] > status_priority[existing["status"]]:
                results_map[roll] = row_data
                
    results = list(results_map.values())

    def sort_key(x):
        order = {
            "Completed": 0,
            "Pending": 1,
            "Absent - No Show": 2,
            "Not Booked": 3
        }
        return order.get(x["status"], 4)
        
    results.sort(key=sort_key)

    title_str = event["title"]
    date_str  = event["event_date"]

    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment
        from openpyxl.utils import get_column_letter

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Results"

        ws.merge_cells("A1:L1")
        c = ws["A1"]
        c.value     = f"Viva Results — {title_str}  ({date_str}  {event['start_time']}–{event['end_time']})"
        c.font      = Font(bold=True, size=13, color="FFFFFF")
        c.fill      = PatternFill("solid", fgColor="1E3A8A")
        c.alignment = Alignment(horizontal="center", vertical="center")
        ws.row_dimensions[1].height = 28

        headers = ["Roll Number", "Name", "Topic", "Slot Date", "Slot Time",
                   "Status", "Knowledge (0-10)", "Understanding (0-10)", "Application (0-10)",
                   f"Marks (out of {_event_marks(event)[1]})", "Grade", "Remarks"]
        hdr_fill = PatternFill("solid", fgColor="2563EB")
        for ci, h in enumerate(headers, 1):
            cell        = ws.cell(row=2, column=ci, value=h)
            cell.font   = Font(bold=True, color="FFFFFF", size=11)
            cell.fill   = hdr_fill
            cell.alignment = Alignment(horizontal="center")
        ws.row_dimensions[2].height = 18

        completed_fill = PatternFill(fill_type=None)
        noshow_fill = PatternFill("solid", fgColor="FEE2E2")
        notbooked_fill = PatternFill("solid", fgColor="FFEDD5")
        pending_fill = PatternFill("solid", fgColor="E0F2FE")

        completed_cnt = 0
        noshow_cnt = 0
        notbooked_cnt = 0
        pending_cnt = 0

        for ri, r in enumerate(results, 3):
            vals = [
                r["roll_number"] or "—", r["name"] or "—", r["topic"],
                r["slot_date"], r["slot_time"], r["status"],
                r["knowledge"], r["understanding"], r["application"],
                r["total"], r["grade"], r["remarks"]
            ]
            row_fill = None
            if r["status"] == "Completed":
                row_fill = completed_fill
                completed_cnt += 1
            elif r["status"] == "Absent - No Show":
                row_fill = noshow_fill
                noshow_cnt += 1
            elif r["status"] == "Not Booked":
                row_fill = notbooked_fill
                notbooked_cnt += 1
            elif r["status"] == "Pending":
                row_fill = pending_fill
                pending_cnt += 1

            for ci, v in enumerate(vals, 1):
                cell = ws.cell(row=ri, column=ci, value=v)
                if row_fill:
                    cell.fill = row_fill
                cell.alignment = Alignment(horizontal="center" if ci in (1, 4, 5, 6, 7, 8, 9, 10, 11) else "left")

        sum_row = len(results) + 3
        ws.merge_cells(start_row=sum_row, start_column=1, end_row=sum_row, end_column=12)
        sum_cell = ws.cell(row=sum_row, column=1)
        sum_cell.value = f"Total: {len(results)} | Completed: {completed_cnt} | Absent: {noshow_cnt} | Not Booked: {notbooked_cnt} | Pending: {pending_cnt}"
        sum_cell.font = Font(bold=True)
        sum_fill = PatternFill("solid", fgColor="F1F5F9")
        for ci in range(1, 13):
            ws.cell(row=sum_row, column=ci).fill = sum_fill
        sum_cell.alignment = Alignment(horizontal="center")

        widths = [16, 24, 20, 13, 15, 18, 12, 14, 12, 10, 8, 45]
        for ci, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(ci)].width = w

        ws.freeze_panes = "A3"

        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        fn = f"viva_{title_str.replace(' ','_')}_{date_str}.xlsx"
        # HTTP headers are latin-1: give an ASCII fallback plus the RFC 5987 UTF-8 name,
        # otherwise titles like "Ohm’s law" or non-English titles crash the export.
        from urllib.parse import quote
        ascii_fn = re.sub(r"[^A-Za-z0-9._-]", "_", fn)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=\"{ascii_fn}\"; filename*=UTF-8''{quote(fn)}"},
        )

    except ImportError:
        out = io.StringIO()
        w   = csv.writer(out)
        w.writerow(["Time Slot", "Roll Number", "Name",
                    "Knowledge", "Understanding", "Confidence",
                    "Presence", "Contribution", "Total", "Grade", "Status"])
        for r in rows:
            slot_start = r["slot_start"]
            slot_end = r["slot_end"]
            time_slot = f"{slot_start}-{slot_end}" if (slot_start and slot_end) else "—"
            w.writerow([
                time_slot,
                r["roll_number"] or "", r["name"] or "",
                r["knowledge"], r["understanding"], r["confidence"],
                r["application"], r["contribution"], r["total"],
                r["grade"], r["slot_status"],
            ])
        out.seek(0)
        return StreamingResponse(
            iter([out.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=viva_{date_str}.csv"},
        )


# ═══════════════════════════════════════════════════════════
#  BACKWARD-COMPAT PIN AUTH (kept for old professor.html)
# ═══════════════════════════════════════════════════════════

class PinRequest(BaseModel):
    pin: str

@router.delete("/content/{upload_id}")
async def delete_content(upload_id: str, token: str):
    _auth(token)
    raise HTTPException(403, CONTENT_MANAGED)


@router.patch("/content/{upload_id}")
async def rename_content(upload_id: str, token: str):
    _auth(token)
    raise HTTPException(403, CONTENT_MANAGED)


@router.post("/auth")
async def auth_pin(req: PinRequest):
    if req.pin != PROFESSOR_PIN:
        raise HTTPException(403, "Invalid PIN")
    return {"ok": True}

@router.get("/dashboard")
async def dashboard(pin: str):
    if pin != PROFESSOR_PIN:
        raise HTTPException(403, "Invalid PIN")
    conn = get_conn()
    students = conn.execute("SELECT * FROM students ORDER BY created_at DESC").fetchall()
    result = []
    for s in students:
        uploads = conn.execute(
            "SELECT * FROM uploads WHERE student_id=? ORDER BY uploaded_at DESC", (s["id"],)
        ).fetchall()
        upload_list = []
        for u in uploads:
            mr = conn.execute("SELECT * FROM marks WHERE upload_id=?", (u["id"],)).fetchone()
            sr = conn.execute(
                "SELECT * FROM viva_sessions WHERE upload_id=? AND completed=TRUE ORDER BY end_time DESC LIMIT 1",
                (u["id"],)
            ).fetchone()
            upload_list.append({
                "upload_id": u["id"], "filename": u["filename"],
                "uploaded_at": u["uploaded_at"],
                "okf_ready": bool(u["okf_ready"]),
                "viva_completed": bool(u["viva_completed"]),
                "marks": dict(mr) if mr else None,
                "session": dict(sr) if sr else None,
            })
        result.append({
            "student_id": s["id"], "roll_number": s["roll_number"],
            "name": s["name"], "joined_at": s["created_at"],
            "uploads": upload_list,
        })
    conn.close()
    return result

@router.get("/transcript/{session_id}")
async def get_transcript(session_id: str, pin: str):
    if pin != PROFESSOR_PIN:
        raise HTTPException(403, "Invalid PIN")
    conn = get_conn()
    sr = conn.execute("SELECT * FROM viva_sessions WHERE id=?", (session_id,)).fetchone()
    if not sr:
        conn.close()
        raise HTTPException(404, "Session not found")
    ur = conn.execute("SELECT * FROM uploads WHERE id=?", (sr["upload_id"],)).fetchone()
    conn.close()
    if not ur or not ur["okf_bundle_path"]:
        raise HTTPException(404, "Transcript not available")
    ep = Path(ur["okf_bundle_path"]).parent / "evaluation" / "result.json"
    if not ep.exists():
        raise HTTPException(404, "Result file not found")
    import json
    with open(ep) as f:
        return json.load(f)

@router.get("/export.csv")
async def export_csv(pin: str):
    if pin != PROFESSOR_PIN:
        raise HTTPException(403, "Invalid PIN")
    conn = get_conn()
    rows = conn.execute("""
        SELECT s.roll_number, s.name, u.filename, u.uploaded_at,
               m.knowledge, m.understanding, m.confidence,
               m.application, m.contribution, m.total, m.grade,
               m.overall_comment, m.created_at as viva_date,
               vs.questions_asked, vs.tab_switch_count, vs.flagged
        FROM marks m
        JOIN students s ON s.id=m.student_id
        JOIN uploads  u ON u.id=m.upload_id
        LEFT JOIN viva_sessions vs ON vs.id=m.session_id
        ORDER BY m.created_at DESC
    """).fetchall()
    conn.close()
    out = io.StringIO()
    w   = csv.writer(out)
    w.writerow(["Roll Number","Name","File","Upload Date",
                "Knowledge","Understanding","Application",
                "Total","Grade","Questions","Tab Switches","Flagged","Comment","Date"])
    for r in rows:
        w.writerow([r["roll_number"], r["name"], r["filename"], r["uploaded_at"],
                    r["knowledge"], r["understanding"], r["application"],
                    r["total"], r["grade"],
                    r["questions_asked"] or 0, r["tab_switch_count"] or 0,
                    "Yes" if r["flagged"] else "No",
                    r["overall_comment"], r["viva_date"]])
    out.seek(0)
    return StreamingResponse(
        iter([out.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=viva_results.csv"},
    )
