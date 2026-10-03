import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..services import orchestrator as orch
from ..database.db import get_conn

router = APIRouter(prefix="/orchestrator", tags=["orchestrator"])


class SpawnRequest(BaseModel):
    roll_number:  str
    student_name: str


@router.post("/spawn")
async def spawn_session(req: SpawnRequest):
    roll = req.roll_number.strip().upper()
    name = req.student_name.strip()

    # Validate student exists
    conn = get_conn()
    student = conn.execute(
        "SELECT * FROM students WHERE roll_number=?", (roll,)
    ).fetchone()
    conn.close()
    if not student:
        raise HTTPException(404, "Roll number not found. Please contact your professor.")

    student_id = student["id"]

    # Already running — return their active session
    active = orch.is_already_active(roll)
    if active:
        return {
            "status":     "active",
            "session_id": active["session_id"],
            "student_id": student_id,
            "message":    f"Welcome back, {name}! Resuming your session.",
        }

    # Find assigned content
    event_info = orch.find_event_for_student(roll)
    if not event_info:
        raise HTTPException(
            404,
            "No active viva event found for your roll number. "
            "Please ask your professor to check the event roster.",
        )

    event_id  = event_info["event_id"]
    upload_id = event_info["upload_id"]

    if orch.can_spawn():
        orch.reserve_slot(roll)
        sub_agent_id = f"agent-{str(uuid.uuid4())[:8]}"
        return {
            "status":        "ready",
            "student_id":    student_id,
            "upload_id":     upload_id,
            "event_id":      event_id,
            "sub_agent_id":  sub_agent_id,
            "student_name":  name,
            "content_title": event_info.get("title", ""),
            "message":       f"Welcome, {name}! Your examiner is ready.",
        }
    else:
        position = orch.add_to_queue(roll, name, student_id, event_id, upload_id)
        return {
            "status":                  "queued",
            "queue_position":          position,
            "students_ahead":          position - 1,
            "estimated_wait_minutes":  position * 15,
            "active_count":            orch.get_status()["active_count"],
            "message":                 f"You are number {position} in the queue.",
        }


@router.get("/status")
async def get_status():
    return orch.get_status()


@router.get("/queue/{roll_number}")
async def check_queue(roll_number: str):
    roll = roll_number.strip().upper()

    # Already running?
    active = orch.is_already_active(roll)
    if active:
        return {
            "status":     "active",
            "session_id": active["session_id"],
        }

    entry = orch.get_queue_entry(roll)
    if entry is None:
        return {"status": "not_in_queue"}

    # Slot opened while they were waiting?
    if orch.can_spawn():
        popped = orch.pop_from_queue(roll)
        if popped:
            orch.reserve_slot(roll)
            sub_agent_id = f"agent-{str(uuid.uuid4())[:8]}"
            return {
                "status":       "ready",
                "student_id":   popped["student_id"],
                "upload_id":    popped["upload_id"],
                "event_id":     popped["event_id"],
                "sub_agent_id": sub_agent_id,
            }

    status = orch.get_status()
    return {
        "status":          "waiting",
        "queue_position":  entry["position"],
        "students_ahead":  entry["position"] - 1,
        "active_count":    status["active_count"],
        "available_slots": status["available_slots"],
        "queue_length":    status["queue_length"],
    }


@router.post("/complete/{session_id}")
async def complete_session(session_id: str):
    info = orch.complete_session(session_id)
    return {"success": True, "released": info is not None}
