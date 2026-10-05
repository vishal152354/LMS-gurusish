import os, re, json, csv, io, uuid, hashlib, hmac, smtplib, logging
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..database.db import get_conn
from ..services.okf_pipeline import run_pipeline, get_pipeline_status
from ..services.hermes_client import hermes_client

router = APIRouter(prefix="/professor", tags=["professor"])

UPLOADS_DIR = Path(os.path.expanduser("~/viva-webapp/data/professor-uploads"))
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

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
#  CONTENT UPLOAD
# ═══════════════════════════════════════════════════════════

def _safe(filename: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", filename)

@router.post("/content/upload")
async def upload_content(
    background_tasks: BackgroundTasks,
    token: str = Form(...),
    file: UploadFile = File(...),
):
    prof = _auth(token)
    ts        = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    safe_fn   = _safe(file.filename)
    upload_id = f"{ts}_{safe_fn}"

    dest_dir  = UPLOADS_DIR / prof["id"] / upload_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / safe_fn

    raw = await file.read()
    dest_path.write_bytes(raw)

    conn = get_conn()
    conn.execute(
        """INSERT INTO uploads
           (id, student_id, professor_id, filename, upload_path,
            okf_bundle_path, graph_path, okf_ready, viva_completed, uploaded_at, display_name)
           VALUES (?,NULL,?,?,?,?,?,0,0,?,?)""",
        (upload_id, prof["id"], file.filename, str(dest_path), "", "",
         datetime.utcnow().isoformat(), file.filename),
    )
    conn.commit()
    conn.close()

    async def _run():
        result = await run_pipeline(
            prof["id"], prof["display_name"], file.filename,
            str(dest_path), ts, hermes_client, upload_id
        )
        if result.get("ok"):
            c2 = get_conn()
            c2.execute(
                "UPDATE uploads SET okf_bundle_path=?,graph_path=?,okf_ready=1 WHERE id=?",
                (result["bundle_path"], result["graph_path"], upload_id),
            )
            c2.commit()
            c2.close()

    background_tasks.add_task(_run)
    return {"upload_id": upload_id, "filename": file.filename,
            "status_url": f"/student/pipeline/status/{upload_id}"}


@router.get("/content")
async def list_content(token: str):
    prof = _auth(token)
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM uploads WHERE professor_id=? ORDER BY uploaded_at DESC",
        (prof["id"],)
    ).fetchall()
    conn.close()
    out = []
    for u in rows:
        st = get_pipeline_status(u["id"])
        out.append({
            "upload_id":   u["id"],
            "filename":    u["filename"],
            "display_name": u["display_name"] or u["filename"],
            "okf_ready":   bool(u["okf_ready"]),
            "uploaded_at": u["uploaded_at"],
            "step":        st.get("step", 0),
            "percentage":  st.get("percentage", 0),
            "label":       st.get("label", ""),
        })
    return out


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
    upload_id:          str
    title:              str
    num_questions:      int = 10   # how many MCQs on this test
    marks_per_question: int = 1    # marks awarded for each correct answer
    event_date:         Optional[str] = None   # legacy (slots) — unused in the roster model
    start_time:         Optional[str] = None
    end_time:           Optional[str] = None
    max_students:       int = 50


@router.post("/events")
async def create_event(token: str, req: CreateEventRequest):
    prof = _auth(token)

    num_questions      = max(1, min(50, req.num_questions))
    marks_per_question = max(1, min(100, req.marks_per_question))
    pid = req.progress_id
    _set_event_progress(pid, "reading")

    conn = get_conn()
    upload = conn.execute(
        "SELECT * FROM uploads WHERE id=? AND professor_id=?",
        (req.upload_id, prof["id"])
    ).fetchone()
    if not upload:
        conn.close()
        raise HTTPException(404, "Content not found")
    if not upload["okf_ready"]:
        conn.close()
        raise HTTPException(400, "Knowledge base is still processing. Please wait until it's ready.")

    # Generate the MCQ paper NOW (pre-computed) so students start instantly.
    graph = None
    if upload["graph_path"] and Path(upload["graph_path"]).exists():
        try:
            graph = json.load(open(upload["graph_path"]))
        except Exception:
            graph = None
    if not graph or not graph.get("nodes"):
        conn.close()
        _set_event_progress(pid, "failed")
        raise HTTPException(500, "Knowledge graph missing for this content; cannot build questions.")

    summary = ""
    gp = upload["graph_path"]
    if gp:
        sp = Path(gp).parent / "knowledge-graph-summary.md"
        if sp.exists():
            summary = sp.read_text()

    questions = await hermes_client.generate_mcq_quiz(
        graph, summary, "Student", num_questions=num_questions,
        on_progress=lambda stage, attempt: _set_event_progress(pid, stage, attempt),
    )
    if not questions:
        _set_event_progress(pid, "failed")
        conn.close()
        raise HTTPException(502, "Could not generate questions from this content. Please try again.")

    _set_event_progress(pid, "saving")
    event_id     = str(uuid.uuid4())
    now          = datetime.utcnow().isoformat()
    max_students = max(1, min(200, req.max_students))

    conn.execute(
        """INSERT INTO viva_events
           (id,professor_id,upload_id,title,event_date,start_time,end_time,status,max_students,
            num_questions,marks_per_question,questions_json,created_at)
           VALUES (?,?,?,?,?,?,?,'scheduled',?,?,?,?,?)""",
        (event_id, prof["id"], req.upload_id, req.title,
         req.event_date or now[:10], req.start_time or "", req.end_time or "", max_students,
         len(questions), marks_per_question, json.dumps(questions), now),
    )
    conn.commit()
    conn.close()
    _set_event_progress(pid, "done", generated=len(questions))
    return {
        "event_id":           event_id,
        "num_questions":      len(questions),
        "marks_per_question": marks_per_question,
        "total_marks":        len(questions) * marks_per_question,
    }


@router.get("/events")
async def list_events(token: str):
    prof = _auth(token)
    conn = get_conn()
    events = conn.execute(
        "SELECT * FROM viva_events WHERE professor_id=? ORDER BY event_date DESC, start_time DESC",
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
        content = conn.execute("SELECT display_name, filename FROM uploads WHERE id=?", (e["upload_id"],)).fetchone()
        out.append({
            "event_id":     e["id"],
            "title":        e["title"],
            "upload_id":    e["upload_id"],
            "content_name": (content["display_name"] or content["filename"]) if content else "",
            "event_date":   e["event_date"],
            "start_time":   e["start_time"],
            "end_time":     e["end_time"],
            "status":       e["status"],
            "max_students": e["max_students"] if "max_students" in e.keys() else 10,
            "num_questions":      e["num_questions"] if "num_questions" in e.keys() and e["num_questions"] else 10,
            "marks_per_question": e["marks_per_question"] if "marks_per_question" in e.keys() and e["marks_per_question"] else 1,
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

@router.get("/events/{event_id}/results")
async def get_event_results(event_id: str, token: str):
    """Return all roster students with statuses and marks for a professor's event."""
    prof = _auth(token)
    
    # Run no show checks first to update database status
    from .student import run_no_show_checks, _local_now
    run_no_show_checks()
    
    conn = get_conn()
    event = conn.execute(
        "SELECT * FROM viva_events WHERE id=? AND professor_id=?",
        (event_id, prof["id"])
    ).fetchone()
    if not event:
        conn.close()
        raise HTTPException(404, "Event not found")

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
        max_marks = _nq * _mpq

        # Answer breakdown for the per-student chart
        breakdown = None
        if status == "Completed":
            try:
                qlog = json.loads(r["question_log"] or "[]")
            except Exception:
                qlog = []
            if qlog:
                correct_n    = sum(1 for q in qlog if q.get("is_correct"))
                unanswered_n = sum(1 for q in qlog if q.get("selected_index") is None)
                breakdown = {
                    "correct": correct_n,
                    "wrong": len(qlog) - correct_n - unanswered_n,
                    "unanswered": unanswered_n,
                    "questions": [{
                        "number":   q.get("question_number"),
                        "question": q.get("question", ""),
                        "chosen":   (q["options"][q["selected_index"]]
                                     if q.get("selected_index") is not None and q.get("options") else None),
                        "correct_option": q.get("correct_option", ""),
                        "is_correct": bool(q.get("is_correct")),
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
    prof = _auth(token)
    
    # Run no show checks first to update database status
    from .student import run_no_show_checks, _local_now
    run_no_show_checks()
    
    conn = get_conn()
    event = conn.execute(
        "SELECT * FROM viva_events WHERE id=? AND professor_id=?", (event_id, prof["id"])
    ).fetchone()
    if not event:
        conn.close()
        raise HTTPException(404, "Event not found")

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
                   "Total (0-30)", "Grade", "Remarks"]
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
    prof = _auth(token)
    conn = get_conn()
    
    # Check safety: any event references this upload_id?
    referencing_events = conn.execute(
        "SELECT title FROM viva_events WHERE upload_id=?", (upload_id,)
    ).fetchall()
    
    if referencing_events:
        conn.close()
        event_titles = ", ".join([r["title"] for r in referencing_events])
        raise HTTPException(
            400,
            f"This content is used by event(s): {event_titles}. Delete or reassign those events first."
        )
        
    # Fetch paths before deleting row
    upload = conn.execute(
        "SELECT * FROM uploads WHERE id=? AND professor_id=?", (upload_id, prof["id"])
    ).fetchone()
    
    if not upload:
        conn.close()
        raise HTTPException(404, "Content not found")
        
    conn.execute("DELETE FROM uploads WHERE id=?", (upload_id,))
    conn.commit()
    conn.close()
    
    # Delete files from disk safely
    import shutil
    upload_path = upload["upload_path"]
    if upload_path:
        try:
            if os.path.exists(upload_path):
                os.remove(upload_path)
            folder_path = os.path.dirname(upload_path)
            if os.path.isdir(folder_path):
                shutil.rmtree(folder_path)
        except Exception as e:
            log.error(f"Failed to delete upload file/folder: {e}")
            
    okf_bundle_path = upload["okf_bundle_path"]
    if okf_bundle_path:
        try:
            if os.path.isdir(okf_bundle_path):
                shutil.rmtree(okf_bundle_path)
        except Exception as e:
            log.error(f"Failed to delete OKF bundle: {e}")
            
    graph_path = upload["graph_path"]
    if graph_path:
        try:
            if os.path.exists(graph_path):
                os.remove(graph_path)
            summary_path = graph_path.replace("knowledge-graph.json", "summary.txt")
            if os.path.exists(summary_path):
                os.remove(summary_path)
            parent_graph = os.path.dirname(graph_path)
            if os.path.isdir(parent_graph) and not os.listdir(parent_graph):
                os.rmdir(parent_graph)
        except Exception as e:
            log.error(f"Failed to delete graph files: {e}")
            
    return {"ok": True}


class RenameContentRequest(BaseModel):
    display_name: str
    
@router.patch("/content/{upload_id}")
async def rename_content(upload_id: str, req: RenameContentRequest, token: str):
    prof = _auth(token)
    display_name = req.display_name.strip()
    if not display_name:
        raise HTTPException(400, "Display name cannot be empty")
        
    conn = get_conn()
    upload = conn.execute(
        "SELECT id FROM uploads WHERE id=? AND professor_id=?", (upload_id, prof["id"])
    ).fetchone()
    if not upload:
        conn.close()
        raise HTTPException(404, "Content not found")
        
    conn.execute(
        "UPDATE uploads SET display_name=? WHERE id=?", (display_name, upload_id)
    )
    conn.commit()
    conn.close()
    return {"ok": True, "display_name": display_name}


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
                "SELECT * FROM viva_sessions WHERE upload_id=? AND completed=1 ORDER BY end_time DESC LIMIT 1",
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
