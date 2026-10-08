import os, uuid, json, re, asyncio
from datetime import datetime, timedelta, timezone

_TZ_OFFSET_H = float(os.getenv("TZ_OFFSET_HOURS", "5.5"))
_LOCAL_TZ    = timezone(timedelta(hours=_TZ_OFFSET_H))

def _local_now() -> datetime:
    return datetime.now(_LOCAL_TZ).replace(tzinfo=None)

def _utcnow() -> datetime:
    return datetime.utcnow()
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..database.db import get_conn
from ..services.okf_pipeline import run_pipeline, get_pipeline_status
from ..services.hermes_client import hermes_client

router = APIRouter(prefix="/student", tags=["student"])

UPLOADS_DIR = Path(os.path.expanduser("~/viva-webapp/data/uploads"))
SESSIONS_ROOT = Path(os.path.expanduser("~/.hermes/workspace/viva-sessions"))
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")

def _safe_name(filename: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", filename)

def _ts() -> str:
    return _utcnow().strftime("%Y%m%d_%H%M%S")

def _now() -> str:
    return _utcnow().isoformat()

# ──────────────────────────────────────────────────────────────
# JOIN
# ──────────────────────────────────────────────────────────────

class JoinRequest(BaseModel):
    roll_number: str
    name: str

@router.post("/join")
async def student_join(req: JoinRequest):
    roll = req.roll_number.strip().upper()
    name = req.name.strip()

    if not roll or not name:
        raise HTTPException(400, "roll_number and name are required")

    # student_id is ONLY the roll number — name changes are allowed
    student_id = roll
    conn = get_conn()
    row = conn.execute("SELECT * FROM students WHERE id=?", (student_id,)).fetchone()

    on_roster = conn.execute("SELECT id FROM event_students WHERE roll_number=?", (roll,)).fetchone()
    roster_uploaded = 1 if on_roster else 0

    if row is None:
        # new student
        conn.execute(
            "INSERT INTO students (id,roll_number,name,master_folder,total_uploads,created_at,roster_uploaded) VALUES (?,?,?,?,0,?,?)",
            (student_id, roll, name, str(SESSIONS_ROOT / student_id), _now(), roster_uploaded),
        )
        conn.commit()
        conn.close()
        return {"student_id": student_id, "name": name, "is_returning": False, "uploads": []}

    # returning student — update name/roster in case it changed, then fetch uploads
    conn.execute("UPDATE students SET name=?, roster_uploaded=? WHERE id=?", (name, roster_uploaded, student_id))
    conn.commit()

    uploads = conn.execute(
        "SELECT * FROM uploads WHERE student_id=? ORDER BY uploaded_at DESC", (student_id,)
    ).fetchall()

    upload_list = []
    for u in uploads:
        marks_row = conn.execute(
            "SELECT total, grade FROM marks WHERE upload_id=?", (u["id"],)
        ).fetchone()
        upload_list.append({
            "upload_id":      u["id"],
            "filename":       u["filename"],
            "uploaded_at":    u["uploaded_at"],
            "okf_ready":      bool(u["okf_ready"]),
            "viva_completed": bool(u["viva_completed"]),
            "total_marks":    marks_row["total"] if marks_row else None,
            "grade":          marks_row["grade"] if marks_row else None,
        })

    conn.close()
    return {"student_id": student_id, "name": name, "is_returning": True, "uploads": upload_list}

# ──────────────────────────────────────────────────────────────
# UPLOAD
# ──────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_file(
    background_tasks: BackgroundTasks,
    student_id: str = Form(...),
    file: UploadFile = File(...),
):
    conn = get_conn()
    student = conn.execute("SELECT * FROM students WHERE id=?", (student_id,)).fetchone()
    if student is None:
        conn.close()
        raise HTTPException(404, "Student not found — please join first")

    roll   = student["roll_number"]
    name   = student["name"]
    ts     = _ts()
    safe_filename = _safe_name(file.filename)
    upload_id = f"{ts}_{safe_filename}"

    dest_dir = UPLOADS_DIR / student_id / upload_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / safe_filename

    content = await file.read()
    with open(dest_path, "wb") as f:
        f.write(content)

    db_upload_id = upload_id
    conn.execute(
        """INSERT INTO uploads
           (id,student_id,filename,upload_path,okf_bundle_path,graph_path,okf_ready,viva_completed,uploaded_at)
           VALUES (?,?,?,?,?,?,0,0,?)""",
        (db_upload_id, student_id, file.filename, str(dest_path), "", "", _now()),
    )
    conn.execute("UPDATE students SET total_uploads=total_uploads+1 WHERE id=?", (student_id,))
    conn.commit()
    conn.close()

    async def _run():
        result = await run_pipeline(
            roll, name, file.filename, str(dest_path),
            ts, hermes_client, db_upload_id
        )
        if result.get("ok"):
            conn2 = get_conn()
            conn2.execute(
                "UPDATE uploads SET okf_bundle_path=?,graph_path=?,okf_ready=1 WHERE id=?",
                (result["bundle_path"], result["graph_path"], db_upload_id),
            )
            conn2.commit()
            conn2.close()

    background_tasks.add_task(_run)

    return {
        "upload_id":           db_upload_id,
        "filename":            file.filename,
        "pipeline_status_url": f"/student/pipeline/status/{db_upload_id}",
    }

# ──────────────────────────────────────────────────────────────
# PIPELINE STATUS
# ──────────────────────────────────────────────────────────────

@router.get("/pipeline/status/{upload_id}")
async def pipeline_status(upload_id: str):
    return get_pipeline_status(upload_id)

# ──────────────────────────────────────────────────────────────
# LIST UPLOADS
# ──────────────────────────────────────────────────────────────

@router.get("/uploads/{student_id}")
async def list_uploads(student_id: str):
    conn = get_conn()
    uploads = conn.execute(
        "SELECT * FROM uploads WHERE student_id=? ORDER BY uploaded_at DESC", (student_id,)
    ).fetchall()
    result = []
    for u in uploads:
        marks_row = conn.execute(
            "SELECT total,grade FROM marks WHERE upload_id=?", (u["id"],)
        ).fetchone()
        status = get_pipeline_status(u["id"])
        result.append({
            "upload_id":      u["id"],
            "filename":       u["filename"],
            "uploaded_at":    u["uploaded_at"],
            "okf_ready":      bool(u["okf_ready"]),
            "viva_completed": bool(u["viva_completed"]),
            "total_marks":    marks_row["total"] if marks_row else None,
            "grade":          marks_row["grade"] if marks_row else None,
            "pipeline_step":  status.get("step", 0),
            "pipeline_pct":   status.get("percentage", 0),
        })
    conn.close()
    return result

# ──────────────────────────────────────────────────────────────
# MY RESULTS (all completed vivas — V1 + V2)
# ──────────────────────────────────────────────────────────────

@router.get("/my-results")
async def my_results(student_id: str):
    conn = get_conn()
    rows = conn.execute("""
        SELECT m.id AS marks_id, m.upload_id, m.session_id,
               m.total, m.grade, m.created_at,
               vs.slot_id, vs.event_id, vs.start_time,
               ve.title  AS event_title,
               ve.event_date,
               es.slot_start, es.slot_end,
               u.filename
        FROM marks m
        LEFT JOIN viva_sessions vs ON vs.id = m.session_id
        LEFT JOIN viva_events   ve ON ve.id = vs.event_id
        LEFT JOIN event_slots   es ON es.id = vs.slot_id
        LEFT JOIN uploads        u ON  u.id = m.upload_id
        WHERE m.student_id = ?
        ORDER BY m.created_at DESC
    """, (student_id,)).fetchall()
    conn.close()

    results = []
    for r in rows:
        is_v2 = bool(r["slot_id"])
        filename = r["filename"]
        if not filename and r["upload_id"]:
            parts = r["upload_id"].split("_", 2)
            if len(parts) > 2:
                filename = parts[2]
            else:
                filename = r["upload_id"]
        results.append({
            "marks_id":    r["marks_id"],
            "session_id":  r["session_id"],
            "upload_id":   r["upload_id"],
            "total_marks": r["total"],
            "grade":       r["grade"],
            "completed_at": r["created_at"],
            "is_v2":       is_v2,
            # V2 fields
            "event_title": r["event_title"],
            "event_date":  r["event_date"],
            "slot_start":  r["slot_start"],
            "slot_end":    r["slot_end"],
            # V1 fields
            "filename":    filename,
        })
    return results


# ──────────────────────────────────────────────────────────────
# GET RESULT
# ──────────────────────────────────────────────────────────────

@router.get("/result/{student_id}/{upload_id}")
async def get_result(student_id: str, upload_id: str, event_id: str = None):
    conn = get_conn()
    if event_id:
        marks_row = conn.execute(
            """
            SELECT m.* FROM marks m
            JOIN viva_sessions s ON m.session_id = s.id
            WHERE m.student_id=? AND m.upload_id=? AND s.event_id=?
            """,
            (student_id, upload_id, event_id)
        ).fetchone()
    else:
        marks_row = conn.execute(
            "SELECT * FROM marks WHERE student_id=? AND upload_id=?", (student_id, upload_id)
        ).fetchone()
    if not marks_row:
        conn.close()
        raise HTTPException(404, "Result not found")

    student_row = conn.execute(
        "SELECT name, roll_number FROM students WHERE id=?", (student_id,)
    ).fetchone()
    upload_row = conn.execute(
        "SELECT filename, okf_bundle_path, uploaded_at FROM uploads WHERE id=?", (upload_id,)
    ).fetchone()
    conn.close()

    m = dict(marks_row)
    strong_areas     = json.loads(m.get("strong_areas")     or "[]")
    areas_to_improve = json.loads(m.get("areas_to_improve") or "[]")

    # Build a normalised response that matches what complete.html expects
    result = {
        # identity
        "student_name":    student_row["name"]        if student_row else student_id,
        "roll_number":     student_row["roll_number"] if student_row else student_id,
        "filename":        upload_row["filename"]     if upload_row  else "",
        "date":            upload_row["uploaded_at"]  if upload_row  else "",
        # scores — exposed both flat AND nested so complete.html works either way
        "final_marks":     m.get("total", 0),
        "grade":           m.get("grade", "—"),
        "marks_breakdown": {
            "knowledge":        m.get("knowledge",        0),
            "understanding":    m.get("understanding",    0),
            "application":      m.get("application",      0),
            "total":            m.get("total",            0),
        },
        # feedback
        "strong_areas":     strong_areas,
        "areas_to_improve": areas_to_improve,
        "overall_comment":  m.get("overall_comment", ""),
    }

    # This attempt's own answers (saved with its session)
    conn = get_conn()
    sess = conn.execute("SELECT question_log, event_id FROM viva_sessions WHERE id=?",
                        (m.get("session_id"),)).fetchone()
    ev = conn.execute("SELECT num_questions, marks_per_question FROM viva_events WHERE id=?",
                      (event_id or (sess["event_id"] if sess else None),)).fetchone()
    conn.close()
    if sess and sess["question_log"]:
        try:
            result["question_log"] = json.loads(sess["question_log"])
        except Exception:
            pass
    elif not event_id and upload_row and upload_row["okf_bundle_path"]:
        # legacy attempts: the per-upload evaluation file (last finisher only)
        eval_path = Path(upload_row["okf_bundle_path"]).parent / "evaluation" / "result.json"
        if eval_path.exists():
            with open(eval_path) as f:
                result["question_log"] = json.load(f).get("question_log", [])
    if ev and ev["num_questions"]:
        result["max_marks"] = ev["num_questions"] * (ev["marks_per_question"] or 1)
        result["total_questions"] = ev["num_questions"]

    return result

# ──────────────────────────────────────────────────────────────
# V3 — ROSTER-MAPPED TESTS (always available, one attempt each)
# ──────────────────────────────────────────────────────────────

@router.get("/my-tests")
async def my_tests(roll_number: str):
    """Every test this student is rostered for — always available, no slots.

    Each test reports whether the student has already attempted it (a marks row
    exists) along with their score, so the UI can lock completed tests.
    """
    roll = roll_number.strip().upper()
    conn = get_conn()
    rows = conn.execute(
        """SELECT e.id AS event_id, e.title, e.upload_id, e.status, e.created_at,
                  e.num_questions, e.marks_per_question
           FROM event_students es
           JOIN viva_events e ON e.id = es.event_id
           WHERE es.roll_number = ?
           ORDER BY e.created_at DESC""",
        (roll,),
    ).fetchall()

    tests = []
    for e in rows:
        upload = conn.execute(
            "SELECT display_name, filename, okf_ready FROM uploads WHERE id=?",
            (e["upload_id"],),
        ).fetchone()
        # Attempt status is per event — the same content can back several events
        mark = conn.execute(
            """SELECT m.total, m.grade FROM marks m
               JOIN viva_sessions s ON s.id = m.session_id
               WHERE m.student_id=? AND s.event_id=?
               ORDER BY m.created_at DESC LIMIT 1""",
            (roll, e["event_id"]),
        ).fetchone()
        ekeys = e.keys()
        n_q  = (e["num_questions"] if "num_questions" in ekeys and e["num_questions"] else 10)
        m_pq = (e["marks_per_question"] if "marks_per_question" in ekeys and e["marks_per_question"] else 1)
        tests.append({
            "event_id":      e["event_id"],
            "title":         e["title"] or "Viva Examination",
            "upload_id":     e["upload_id"],
            "filename":      (upload["display_name"] or upload["filename"]) if upload else e["upload_id"],
            "ready":         bool(upload["okf_ready"]) if upload else False,
            "num_questions": n_q,
            "max_marks":     n_q * m_pq,
            "attempted":     mark is not None,
            "score":         mark["total"] if mark else None,
            "grade":         mark["grade"] if mark else None,
        })
    conn.close()
    return {"tests": tests}


# ──────────────────────────────────────────────────────────────
# V2 — EVENTS & BOOKING (legacy slot flow — kept for compatibility)
# ──────────────────────────────────────────────────────────────

@router.get("/events")
async def list_events(student_id: str):
    conn = get_conn()
    student = conn.execute("SELECT * FROM students WHERE id=?", (student_id,)).fetchone()
    if not student:
        conn.close()
        raise HTTPException(404, "Student not found")

    today = _local_now().date().isoformat()
    yesterday = (_local_now() - timedelta(days=1)).date().isoformat()
    
    # Query events scheduled for today/future, OR yesterday's events where student has a booking
    events = conn.execute(
        """SELECT DISTINCT ve.* FROM viva_events ve
           LEFT JOIN event_students es ON es.event_id=ve.id AND es.roll_number=?
           LEFT JOIN event_slots slots ON slots.event_id=ve.id AND slots.student_id=?
           WHERE ve.status='scheduled' AND (
               ve.event_date >= ? 
               OR (ve.event_date >= ? AND slots.id IS NOT NULL)
           )
           ORDER BY ve.event_date, ve.start_time""",
        (student["roll_number"], student_id, today, yesterday)
    ).fetchall()

    out = []
    for e in events:
        total  = conn.execute("SELECT COUNT(*) FROM event_slots WHERE event_id=?",   (e["id"],)).fetchone()[0]
        avail  = conn.execute("SELECT COUNT(*) FROM event_slots WHERE event_id=? AND status='available'", (e["id"],)).fetchone()[0]
        booked = conn.execute(
            "SELECT * FROM event_slots WHERE event_id=? AND student_id=?",
            (e["id"], student_id)
        ).fetchone()
        
        booked_dict = None
        if booked:
            booked_dict = dict(booked)
            if booked["status"] == "completed" and booked["session_id"]:
                mark = conn.execute(
                    "SELECT total, grade FROM marks WHERE session_id=?",
                    (booked["session_id"],)
                ).fetchone()
                if mark:
                    booked_dict["total_marks"] = mark["total"]
                    booked_dict["grade"] = mark["grade"]
        content = conn.execute("SELECT display_name, filename FROM uploads WHERE id=?", (e["upload_id"],)).fetchone()
        on_roster = conn.execute(
            "SELECT id FROM event_students WHERE event_id=? AND roll_number=?",
            (e["id"], student["roll_number"])
        ).fetchone()
        out.append({
            "event_id":   e["id"],
            "title":      e["title"],
            "event_date": e["event_date"],
            "start_time": e["start_time"],
            "end_time":   e["end_time"],
            "content_name": (content["display_name"] or content["filename"]) if content else "",
            "total_slots":  total,
            "available_slots": avail,
            "on_roster":  bool(on_roster),
            "my_booking": booked_dict,
        })
    conn.close()
    return out


@router.get("/events/{event_id}/slots")
async def list_slots(event_id: str, student_id: str):
    # First, run no-show checks to mark missed bookings as no_show
    from .student import run_no_show_checks
    run_no_show_checks()

    conn = get_conn()
    event = conn.execute("SELECT * FROM viva_events WHERE id=?", (event_id,)).fetchone()
    if not event:
        conn.close()
        raise HTTPException(404, "Event not found")

    slots = conn.execute(
        "SELECT * FROM event_slots WHERE event_id=? ORDER BY slot_index",
        (event_id,)
    ).fetchall()
    
    now_dt = _local_now()
    
    # Auto-disable unbooked slots that have passed
    for s in slots:
        if s["status"] == "available":
            try:
                start_str = f"{event['event_date']} {s['slot_start']}"
                dt_start = datetime.strptime(start_str, "%Y-%m-%d %H:%M")
                if now_dt > dt_start:
                    conn.execute("UPDATE event_slots SET status='disabled' WHERE id=?", (s["id"],))
            except:
                pass
    conn.commit()

    # Re-fetch slots after auto-disabling
    slots = conn.execute(
        "SELECT * FROM event_slots WHERE event_id=? ORDER BY slot_index",
        (event_id,)
    ).fetchall()
    conn.close()

    # Group slots by slot_start to handle multi-student slots
    slots_by_time = {}
    for s in slots:
        start = s["slot_start"]
        if start not in slots_by_time:
            slots_by_time[start] = []
        slots_by_time[start].append(s)

    out = []
    # Maintain ordering of slots by iterating over unique start times in order
    unique_starts = sorted(slots_by_time.keys())
    for start in unique_starts:
        group = slots_by_time[start]
        # Find if this student has booked any slot in this time window
        my_slot = next((s for s in group if s["student_id"] == student_id), None)
        
        if my_slot:
            # If the student has booked this slot, show it as theirs
            out.append({
                "slot_id":    my_slot["id"],
                "slot_start": my_slot["slot_start"],
                "slot_end":   my_slot["slot_end"],
                "status":     my_slot["status"],
                "is_mine":    True,
            })
        else:
            # Find an available slot in this time window (no student_id assigned)
            avail_slot = next((s for s in group if s["student_id"] is None and s["status"] == "available"), None)
            if avail_slot:
                status = "available"
                try:
                    start_str = f"{event['event_date']} {avail_slot['slot_start']}"
                    dt_start = datetime.strptime(start_str, "%Y-%m-%d %H:%M")
                    if now_dt > dt_start:
                        status = "disabled"
                except:
                    pass
                out.append({
                    "slot_id":    avail_slot["id"],
                    "slot_start": avail_slot["slot_start"],
                    "slot_end":   avail_slot["slot_end"],
                    "status":     status,
                    "is_mine":    False,
                })
            else:
                # All slots in this time window are booked by other students or disabled
                # Return one of them as 'disabled' (Not available)
                rep_slot = group[0]
                out.append({
                    "slot_id":    rep_slot["id"],
                    "slot_start": rep_slot["slot_start"],
                    "slot_end":   rep_slot["slot_end"],
                    "status":     "disabled",
                    "is_mine":    False,
                })
    return out


class BookSlotRequest(BaseModel):
    student_id: str
    slot_id:    str

@router.post("/events/{event_id}/book")
async def book_slot(event_id: str, req: BookSlotRequest):
    conn = get_conn()

    # check event exists
    event = conn.execute("SELECT * FROM viva_events WHERE id=?", (event_id,)).fetchone()
    if not event:
        conn.close()
        raise HTTPException(404, "Event not found")

    # check student exists
    student = conn.execute("SELECT * FROM students WHERE id=?", (req.student_id,)).fetchone()
    if not student:
        conn.close()
        raise HTTPException(404, "Student not found")

    # check student doesn't already have an active ('booked') booking in this event
    existing = conn.execute(
        "SELECT * FROM event_slots WHERE event_id=? AND student_id=? AND status='booked'",
        (event_id, req.student_id)
    ).fetchone()
    if existing:
        conn.close()
        raise HTTPException(400, "You already have an active booking in this event")

    # check slot is available and has not started yet
    slot = conn.execute(
        "SELECT * FROM event_slots WHERE id=? AND event_id=?", (req.slot_id, event_id)
    ).fetchone()
    if not slot:
        conn.close()
        raise HTTPException(404, "Slot not found")
        
    now_dt = _local_now()
    try:
        start_str = f"{event['event_date']} {slot['slot_start']}"
        dt_start = datetime.strptime(start_str, "%Y-%m-%d %H:%M")
        if now_dt > dt_start:
            conn.close()
            raise HTTPException(400, "This slot has already started and cannot be booked")
    except Exception as e:
        conn.close()
        raise HTTPException(400, f"Error parsing slot start time: {e}")

    if slot["status"] != "available":
        conn.close()
        raise HTTPException(400, "This slot is no longer available")

    # Release any previous no_show slots in this event for this student
    conn.execute(
        "UPDATE event_slots SET student_id=NULL, booked_at=NULL, status='available' WHERE event_id=? AND student_id=? AND status='no_show'",
        (event_id, req.student_id)
    )

    now = now_dt.isoformat()
    conn.execute(
        "UPDATE event_slots SET student_id=?, booked_at=?, status='booked' WHERE id=?",
        (req.student_id, now, req.slot_id)
    )
    conn.commit()
    conn.close()
    return {
        "ok": True,
        "slot_id":    req.slot_id,
        "slot_start": slot["slot_start"],
        "slot_end":   slot["slot_end"],
        "event_date": event["event_date"],
        "event_title": event["title"],
        "upload_id":  event["upload_id"],
    }


class CancelBookingRequest(BaseModel):
    student_id: str

@router.post("/events/{event_id}/cancel-booking")
async def cancel_booking(event_id: str, req: CancelBookingRequest):
    conn = get_conn()

    slot = conn.execute(
        "SELECT * FROM event_slots WHERE event_id=? AND student_id=?",
        (event_id, req.student_id)
    ).fetchone()
    if not slot:
        conn.close()
        raise HTTPException(404, "No booking found for this student in this event")
    if slot["status"] != "booked":
        conn.close()
        raise HTTPException(400, "Cannot cancel a slot that is already in progress or completed")

    event = conn.execute("SELECT * FROM viva_events WHERE id=?", (event_id,)).fetchone()
    if not event:
        conn.close()
        raise HTTPException(404, "Event not found")

    now_dt   = _local_now()
    dt_start = datetime.strptime(f"{event['event_date']} {slot['slot_start']}", "%Y-%m-%d %H:%M")
    if dt_start <= now_dt:          # cross-midnight slot on next day
        dt_start += timedelta(days=1)

    mins_until = (dt_start - now_dt).total_seconds() / 60
    if mins_until <= 30:
        conn.close()
        raise HTTPException(400,
            f"Cannot change slot — your viva starts in {int(mins_until)} minute(s). "
            "Changes are only allowed more than 30 minutes before your slot.")

    conn.execute(
        "UPDATE event_slots SET student_id=NULL, booked_at=NULL, status='available' WHERE id=?",
        (slot["id"],)
    )
    conn.commit()
    conn.close()
    return {"ok": True, "slot_start": slot["slot_start"], "slot_end": slot["slot_end"]}


@router.get("/my-booking")
async def my_booking(student_id: str):
    # First, run no-show checks to update passed bookings to 'no_show'
    from .student import run_no_show_checks
    run_no_show_checks()

    conn = get_conn()
    yesterday = (_local_now() - timedelta(days=1)).date().isoformat()
    rows = conn.execute(
        """SELECT es.*, ve.event_date, ve.title, ve.upload_id, ve.start_time AS event_start
           FROM event_slots es
           JOIN viva_events ve ON ve.id = es.event_id
           WHERE es.student_id=? AND ve.event_date >= ?
           ORDER BY ve.event_date, es.slot_start""",
        (student_id, yesterday)
    ).fetchall()

    now = _local_now()
    out = []
    for r in rows:
        dt_start = datetime.strptime(f"{r['event_date']} {r['slot_start']}", "%Y-%m-%d %H:%M")
        dt_end   = datetime.strptime(f"{r['event_date']} {r['slot_end']}",   "%Y-%m-%d %H:%M")
        if dt_end <= dt_start:          # cross-midnight slot
            dt_end += timedelta(days=1)
            
        # Join window: 2 minutes before to 2 minutes after start time
        win_start = dt_start - timedelta(minutes=2)
        win_end = dt_start + timedelta(minutes=2)
        can_join = win_start <= now <= win_end
        
        status = r["status"]
        # If the slot join window has passed and status is still 'booked', mark as 'no_show' (missed)
        if status == "booked" and now > win_end:
            conn.execute(
                "UPDATE event_slots SET status='no_show', missed_at=? WHERE id=?",
                (now.isoformat(), r["id"])
            )
            status = "no_show"
            
        out.append({
            "slot_id":    r["id"],
            "event_id":   r["event_id"],
            "event_title": r["title"],
            "event_date": r["event_date"],
            "slot_start": r["slot_start"],
            "slot_end":   r["slot_end"],
            "upload_id":  r["upload_id"],
            "status":     status,
            "can_join":   can_join and status in ("booked", "in_progress"),
            "starts_in_sec": int((win_start - now).total_seconds()) if now < win_start else 0
        })
    conn.commit()
    conn.close()
    return out


# ── NO-SHOW DETECTION & NOTIFICATIONS ─────────────────────────

def run_no_show_checks():
    import uuid
    conn = get_conn()
    now_dt = _local_now()
    now_str = now_dt.isoformat()
    
    slots = conn.execute("""
        SELECT es.*, ve.event_date, ve.title, ve.upload_id
        FROM event_slots es
        JOIN viva_events ve ON ve.id = es.event_id
        WHERE es.status IN ('booked', 'in_progress')
    """).fetchall()
    
    no_shows_detected = 0
    for s in slots:
        try:
            start_str = f"{s['event_date']} {s['slot_start']}"
            end_str = f"{s['event_date']} {s['slot_end']}"
            dt_start = datetime.strptime(start_str, "%Y-%m-%d %H:%M")
            dt_end = datetime.strptime(end_str, "%Y-%m-%d %H:%M")
            if dt_end <= dt_start:
                dt_end += timedelta(days=1)
                
            if now_dt > dt_end:
                # Check marks
                completed = conn.execute(
                    "SELECT id FROM marks WHERE student_id = ? AND upload_id = ?",
                    (s["student_id"], s["upload_id"])
                ).fetchone()
                
                if completed:
                    conn.execute("UPDATE event_slots SET status = 'completed' WHERE id = ?", (s["id"],))
                    continue
                
                # Mark status as no_show
                conn.execute(
                    "UPDATE event_slots SET status = 'no_show', missed_at = ? WHERE id = ?",
                    (now_str, s["id"])
                )
                
                # Create missed notification
                slot_label = f"{s['event_date']} {s['slot_start']}-{s['slot_end']}"
                existing_notif = conn.execute(
                    "SELECT id FROM notifications WHERE student_id = ? AND type = 'missed' AND slot_time = ?",
                    (s["student_id"], slot_label)
                ).fetchone()
                
                if not existing_notif:
                    expires_dt = dt_end + timedelta(days=1)
                    conn.execute(
                        """INSERT INTO notifications 
                           (id, student_id, type, triggered_at, expires_at, topic, score, grade, slot_time)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            str(uuid.uuid4()),
                            s["student_id"],
                            "missed",
                            dt_end.isoformat(),
                            expires_dt.isoformat(),
                            s["title"],
                            None,
                            None,
                            slot_label
                        )
                    )
                no_shows_detected += 1
        except Exception as e:
            print(f"Error checking slot {s['id']}: {e}")
            
    conn.commit()
    conn.close()
    return no_shows_detected


@router.get("/notifications/{roll_number}")
async def get_student_notifications(roll_number: str):
    roll_number = roll_number.strip().upper()
    run_no_show_checks()
    
    conn = get_conn()
    now_dt = _local_now()
    now_str = now_dt.isoformat()
    
    out = []
    
    # 1. Completed notifications (viva completed within 24h)
    now_utc = _utcnow()
    yesterday_utc_str = (now_utc - timedelta(days=1)).isoformat()
    completed = conn.execute("""
        SELECT m.total, m.grade, vs.end_time, ve.title AS event_title, vs.id AS session_id, ve.upload_id
        FROM marks m
        JOIN viva_sessions vs ON vs.id = m.session_id
        LEFT JOIN viva_events ve ON ve.id = vs.event_id
        WHERE m.student_id = ?
          AND vs.end_time >= ?
        ORDER BY vs.end_time DESC
    """, (roll_number, yesterday_utc_str)).fetchall()
    
    for c in completed:
        end_dt = datetime.fromisoformat(c["end_time"])
        expires_dt = end_dt + timedelta(days=1)
        hours_remaining = max(0.0, (expires_dt - now_utc).total_seconds() / 3600.0)
        
        end_time_str = c["end_time"]
        if not end_time_str.endswith("Z"):
            end_time_str += "Z"
            
        out.append({
            "id": f"completed_{c['session_id']}",
            "type": "completed",
            "topic": c["event_title"] or "Research",
            "score": c["total"],
            "grade": c["grade"],
            "upload_id": c["upload_id"],
            "slot_time": end_time_str,
            "triggered_at": end_time_str,
            "expires_at": expires_dt.isoformat() + "Z",
            "hours_remaining": hours_remaining
        })
        
    # 2. Missed notifications (missed slot within 24h)
    missed = conn.execute("""
        SELECT * FROM notifications
        WHERE student_id = ?
          AND type = 'missed'
          AND expires_at > ?
        ORDER BY expires_at DESC
    """, (roll_number, now_str)).fetchall()
    
    for m in missed:
        expires_dt = datetime.fromisoformat(m["expires_at"])
        hours_remaining = max(0.0, (expires_dt - now_dt).total_seconds() / 3600.0)
        out.append({
            "id": m["id"],
            "type": "missed",
            "topic": m["topic"],
            "score": None,
            "grade": None,
            "slot_time": m["slot_time"],
            "triggered_at": m["triggered_at"],
            "expires_at": m["expires_at"],
            "hours_remaining": hours_remaining
        })
        
    # 3. Upcoming notifications (slot booked in next 24h)
    upcoming_slots = conn.execute("""
        SELECT es.*, ve.title, ve.event_date, ve.upload_id
        FROM event_slots es
        JOIN viva_events ve ON ve.id = es.event_id
        WHERE es.student_id = ?
          AND es.status = 'booked'
        ORDER BY ve.event_date, es.slot_start
    """, (roll_number,)).fetchall()
    
    for us in upcoming_slots:
        try:
            start_str = f"{us['event_date']} {us['slot_start']}"
            end_str = f"{us['event_date']} {us['slot_end']}"
            dt_start = datetime.strptime(start_str, "%Y-%m-%d %H:%M")
            dt_end = datetime.strptime(end_str, "%Y-%m-%d %H:%M")
            if dt_end <= dt_start:
                dt_end += timedelta(days=1)
                
            if now_dt <= dt_start <= (now_dt + timedelta(days=1)):
                expires_str = dt_end.isoformat()
                hours_remaining = max(0.0, (dt_end - now_dt).total_seconds() / 3600.0)
                can_join = (dt_start - timedelta(minutes=2)) <= now_dt <= (dt_end + timedelta(minutes=2))
                
                out.append({
                    "id": f"upcoming_{us['id']}",
                    "type": "upcoming",
                    "topic": us["title"],
                    "score": None,
                    "grade": None,
                    "slot_time": f"{us['event_date']} {us['slot_start']} - {us['slot_end']}",
                    "triggered_at": now_str,
                    "expires_at": expires_str,
                    "hours_remaining": hours_remaining,
                    "slot_start_iso": dt_start.isoformat(),
                    "slot_end_iso": dt_end.isoformat(),
                    "can_join": can_join,
                    "upload_id": us["upload_id"],
                    "slot_id": us["id"]
                })
        except Exception as e:
            print(f"Error checking upcoming slot {us['id']}: {e}")
            
    conn.close()
    
    # Sort stacked vertically in this order: completed, missed, upcoming
    def sort_key(notif):
        order = {"completed": 0, "missed": 1, "upcoming": 2}
        return order.get(notif["type"], 3)
        
    out.sort(key=sort_key)
    return out
