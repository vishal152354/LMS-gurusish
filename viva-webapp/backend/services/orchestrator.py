"""
Orchestrator — manages concurrent viva sub-agent sessions.

Each student who joins gets one isolated Hermes session (their "sub-agent").
Max 10 run simultaneously; extras queue up FCFS.
"""
import uuid, json
from datetime import datetime, timedelta
from typing import Optional
from ..database.db import get_conn

MAX_CONCURRENT = 10
_RESERVATION_TTL_MINUTES = 10  # stale reservations auto-expire after this

# In-memory state (source of truth for live status; DB is the audit trail)
_active:   dict[str, dict] = {}   # session_id -> info dict
_reserved: dict[str, str]  = {}   # roll -> ISO timestamp of reservation
_queue:    list[dict]      = []   # ordered FCFS list


# ── helpers ──────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.utcnow().isoformat()

def _log(event_type: str, roll: str, session_id: str = "",
         sub_agent_id: str = "", details: dict | None = None):
    try:
        conn = get_conn()
        conn.execute(
            "INSERT INTO orchestrator_log "
            "(id,event_type,roll_number,session_id,sub_agent_id,timestamp,details) "
            "VALUES (?,?,?,?,?,?,?)",
            (str(uuid.uuid4()), event_type, roll, session_id,
             sub_agent_id, _now(), json.dumps(details or {})),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass  # never let logging kill the main flow


# ── read ─────────────────────────────────────────────────────────────────────

def get_status() -> dict:
    _purge_stale_reservations()
    total_used = len(_active) + len(_reserved)
    return {
        "active_count":    len(_active),
        "reserved_count":  len(_reserved),
        "slots_used":      total_used,
        "available_slots": max(0, MAX_CONCURRENT - total_used),
        "active_sessions": list(_active.values()),
        "queue":           list(_queue),
        "queue_length":    len(_queue),
    }

def _purge_stale_reservations():
    """Remove reservations older than _RESERVATION_TTL_MINUTES."""
    cutoff = datetime.utcnow() - timedelta(minutes=_RESERVATION_TTL_MINUTES)
    stale = [r for r, ts in _reserved.items()
             if datetime.fromisoformat(ts) < cutoff]
    for r in stale:
        del _reserved[r]


def can_spawn(event_max: int = MAX_CONCURRENT) -> bool:
    _purge_stale_reservations()
    limit = min(event_max, MAX_CONCURRENT)
    return (len(_active) + len(_reserved)) < limit


def reserve_slot(roll: str):
    """Claim a slot at join-time. Released when start is called or on timeout."""
    _reserved[roll] = datetime.utcnow().isoformat()


def release_reservation(roll: str):
    _reserved.pop(roll, None)

def is_already_reserved(roll: str) -> bool:
    _purge_stale_reservations()
    return roll in _reserved

def is_already_active(roll: str) -> Optional[dict]:
    for s in _active.values():
        if s["roll_number"] == roll:
            return s
    return None

def get_queue_entry(roll: str) -> Optional[dict]:
    for e in _queue:
        if e["roll_number"] == roll:
            return e
    return None

def find_event_for_student(roll: str) -> Optional[dict]:
    """Return the best active event that lists this roll number in its roster."""
    conn = get_conn()
    rows = conn.execute("""
        SELECT es.event_id, es.roll_number, es.name AS roster_name,
               ve.upload_id, ve.title, ve.event_date, ve.start_time, ve.end_time,
               COALESCE(ve.max_students, 10) AS max_students
        FROM event_students es
        JOIN viva_events ve ON ve.id = es.event_id
        WHERE es.roll_number = ?
          AND ve.status = 'scheduled'
        ORDER BY ve.event_date ASC, ve.start_time ASC
    """, (roll,)).fetchall()
    conn.close()

    if not rows:
        return None

    import os
    from datetime import timezone
    _TZ_OFFSET_H = float(os.getenv("TZ_OFFSET_HOURS", "5.5"))
    _LOCAL_TZ    = timezone(timedelta(hours=_TZ_OFFSET_H))
    now = datetime.now(_LOCAL_TZ).replace(tzinfo=None)

    active_events = []
    concluded_events = []

    for r in rows:
        try:
            dt_start = datetime.strptime(f"{r['event_date']} {r['start_time']}", "%Y-%m-%d %H:%M")
            dt_end   = datetime.strptime(f"{r['event_date']} {r['end_time']}",   "%Y-%m-%d %H:%M")
            if dt_end <= dt_start:
                dt_end += timedelta(days=1)
                
            # Allow joining up to event end time + 2 minutes join window buffer
            if now <= dt_end + timedelta(minutes=2):
                active_events.append(r)
            else:
                concluded_events.append(r)
        except Exception:
            active_events.append(r)

    if active_events:
        return dict(active_events[0])
    elif concluded_events:
        return dict(concluded_events[-1])
    return None


# ── write ─────────────────────────────────────────────────────────────────────

def register_active(session_id: str, roll: str, student_name: str,
                    student_id: str, sub_agent_id: str,
                    event_id: str, upload_id: str):
    _reserved.pop(roll, None)  # convert reservation → active
    _active[session_id] = {
        "session_id":    session_id,
        "roll_number":   roll,
        "student_name":  student_name,
        "student_id":    student_id,
        "sub_agent_id":  sub_agent_id,
        "event_id":      event_id,
        "upload_id":     upload_id,
        "started_at":    _now(),
        "question_number": 0,
        "score_so_far":    0,
        "status":          "active",
    }
    try:
        conn = get_conn()
        conn.execute(
            "UPDATE viva_sessions "
            "SET sub_agent_id=?, session_status='active', spawn_time=? "
            "WHERE id=?",
            (sub_agent_id, _now(), session_id),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass
    _log("spawn", roll, session_id, sub_agent_id)


def update_progress(session_id: str, question_number: int, score: int):
    if session_id in _active:
        _active[session_id]["question_number"] = question_number
        _active[session_id]["score_so_far"]    = score


def complete_session(session_id: str) -> Optional[dict]:
    info = _active.pop(session_id, None)
    if info:
        try:
            conn = get_conn()
            conn.execute(
                "UPDATE viva_sessions "
                "SET session_status='completed', completion_time=? WHERE id=?",
                (_now(), session_id),
            )
            conn.commit()
            conn.close()
        except Exception:
            pass
        _log("complete", info["roll_number"], session_id, info["sub_agent_id"])
        _reindex_queue()
    return info


def add_to_queue(roll: str, student_name: str, student_id: str,
                 event_id: str, upload_id: str) -> int:
    # Idempotent — return existing position if already queued
    existing = get_queue_entry(roll)
    if existing:
        return existing["position"]

    entry = {
        "id":           str(uuid.uuid4()),
        "roll_number":  roll,
        "student_name": student_name,
        "student_id":   student_id,
        "event_id":     event_id,
        "upload_id":    upload_id,
        "joined_at":    _now(),
        "position":     len(_queue) + 1,
        "status":       "waiting",
    }
    _queue.append(entry)
    try:
        conn = get_conn()
        conn.execute(
            "INSERT INTO queue "
            "(id,roll_number,student_name,student_id,event_id,upload_id,joined_at,position,status)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            (entry["id"], roll, student_name, student_id,
             event_id, upload_id, entry["joined_at"], entry["position"], "waiting"),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass
    _log("queue", roll, "", "", {"position": entry["position"]})
    return entry["position"]


def pop_from_queue(roll: str) -> Optional[dict]:
    for i, e in enumerate(_queue):
        if e["roll_number"] == roll:
            entry = _queue.pop(i)
            _reindex_queue()
            try:
                conn = get_conn()
                conn.execute(
                    "UPDATE queue SET status='spawned' WHERE id=?", (entry["id"],)
                )
                conn.commit()
                conn.close()
            except Exception:
                pass
            _log("dequeue", roll, "", "", {"position": entry["position"]})
            return entry
    return None


def _reindex_queue():
    for i, e in enumerate(_queue):
        e["position"] = i + 1
