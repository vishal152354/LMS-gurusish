import os, uuid, json, re, random, time as _time
from datetime import datetime, timedelta, timezone

_TZ_OFFSET_H = float(os.getenv("TZ_OFFSET_HOURS", "5.5"))   # default IST = UTC+5:30
_LOCAL_TZ    = timezone(timedelta(hours=_TZ_OFFSET_H))

def _local_now() -> datetime:
    return datetime.now(_LOCAL_TZ).replace(tzinfo=None)

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database.db import get_conn
from ..services.hermes_client import hermes_client
from ..services.tts_service import synthesize
from ..services import orchestrator as orch

router = APIRouter(prefix="/student/viva", tags=["viva"])

SESSIONS_ROOT = Path(os.path.expanduser("~/.hermes/workspace/viva-sessions"))

_sessions: dict = {}

def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")

def _now() -> str:
    return datetime.utcnow().isoformat()

def _grade(total: int) -> str:
    if total >= 27: return "Excellent"
    if total >= 22: return "Good"
    if total >= 16: return "Satisfactory"
    if total >= 10: return "Needs improvement"
    return "Unsatisfactory"

def _grade_pct(pct: float) -> str:
    if pct >= 0.85: return "Excellent"
    if pct >= 0.70: return "Good"
    if pct >= 0.50: return "Satisfactory"
    if pct >= 0.35: return "Needs improvement"
    return "Unsatisfactory"

_LETTERS = ["A", "B", "C", "D", "E", "F"]

def _mcq_speech(qnum: int, total: int, q: dict) -> str:
    """Spoken form of an MCQ: question stem followed by each lettered option."""
    opts = ". ".join(f"Option {_LETTERS[i]}: {o}" for i, o in enumerate(q.get("options", [])))
    return f"Question {qnum} of {total}. {q.get('question', '')} {opts}"

def _parse_selection(text: str, num_options: int = 4) -> int | None:
    """Parse a student's MCQ choice into a 0-based index.

    Accepts a digit ('0'-'3' or '1'-'4'), a letter ('A'-'D'), or those with
    surrounding words. Returns None if it can't be interpreted.
    """
    if text is None:
        return None
    s = text.strip().upper()
    if not s:
        return None
    # letter form (A-D), possibly like "Option B" or "B."
    m = re.search(r"\b([A-F])\b", s)
    if m:
        idx = _LETTERS.index(m.group(1))
        if 0 <= idx < num_options:
            return idx
    # pure/leading digit: treat 1-based if in 1..num_options, else 0-based
    m = re.match(r"^\s*(\d+)", s)
    if m:
        n = int(m.group(1))
        if 1 <= n <= num_options:
            return n - 1
        if 0 <= n < num_options:
            return n
    return None

def _load_graph(upload_row) -> Optional[dict]:
    if not upload_row["graph_path"] or not Path(upload_row["graph_path"]).exists():
        return None
    with open(upload_row["graph_path"]) as f:
        return json.load(f)

def _load_mcq(upload_row) -> Optional[list]:
    """Load an mcq.json left by older uploads (uploads no longer generate one)."""
    gp = upload_row.get("graph_path")
    if not gp:
        return None
    p = Path(gp).parent / "mcq.json"
    if not p.exists():
        return None
    try:
        data = json.load(open(p))
        return data if isinstance(data, list) and data else None
    except Exception:
        return None

def _load_node_content(upload_row, node_id: str) -> str:
    bundle_path = upload_row["okf_bundle_path"]
    if not bundle_path:
        return ""
    node_file = Path(bundle_path) / f"{node_id}.md"
    if node_file.exists():
        return node_file.read_text()
    return ""

def _load_graph_summary(upload_row) -> str:
    bundle_path = upload_row["okf_bundle_path"]
    if not bundle_path:
        return ""
    p = Path(bundle_path).parent / "knowledge-graph-summary.md"
    if p.exists():
        return p.read_text()
    return ""

# ──────────────────────────────────────────────────────────────
# START VIVA
# ──────────────────────────────────────────────────────────────

class StartRequest(BaseModel):
    student_id:   str
    upload_id:    Optional[str] = None
    slot_id:      Optional[str] = None
    sub_agent_id: Optional[str] = None   # set by orchestrator flow
    event_id:     Optional[str] = None   # set by orchestrator flow

@router.post("/start")
async def start_viva(req: StartRequest):
    conn = get_conn()
    student = conn.execute("SELECT * FROM students WHERE id=?", (req.student_id,)).fetchone()
    if not student:
        conn.close()
        raise HTTPException(404, "Student not found")

    # ── V2 slot-based start ─────────────────────────────────────
    active_slot_id = req.slot_id
    if req.slot_id:
        slot = conn.execute(
            "SELECT * FROM event_slots WHERE id=? AND student_id=?",
            (req.slot_id, req.student_id)
        ).fetchone()
        if not slot:
            conn.close()
            raise HTTPException(404, "Booking not found for this student")

        event = conn.execute(
            "SELECT * FROM viva_events WHERE id=?", (slot["event_id"],)
        ).fetchone()
        if not event:
            conn.close()
            raise HTTPException(404, "Event not found")

        now_dt   = _local_now()
        dt_start = datetime.strptime(f"{event['event_date']} {slot['slot_start']}", "%Y-%m-%d %H:%M")
        dt_end   = datetime.strptime(f"{event['event_date']} {slot['slot_end']}",   "%Y-%m-%d %H:%M")
        if dt_end <= dt_start:
            dt_end += timedelta(days=1)
        # Join window: 2 minutes before to 2 minutes after start time
        win_start = dt_start - timedelta(minutes=2)
        win_end = dt_start + timedelta(minutes=2)
        window_ok = win_start <= now_dt <= win_end
        if not window_ok:
            conn.close()
            raise HTTPException(403,
                f"Your slot start time is {slot['slot_start']}. "
                "You can only join from 2 minutes before to 2 minutes after the start time."
            )

        upload_id = event["upload_id"]
        upload = conn.execute("SELECT * FROM uploads WHERE id=?", (upload_id,)).fetchone()
        if not upload:
            conn.close()
            raise HTTPException(404, "Content not found")

        conn.execute("UPDATE event_slots SET status='in_progress' WHERE id=?", (req.slot_id,))
        conn.commit()

    # ── Roster-based, always-available start (event_id + upload_id, no slot) ──
    elif req.event_id and req.upload_id:
        upload = conn.execute("SELECT * FROM uploads WHERE id=?",
                              (req.upload_id,)).fetchone()
        if not upload:
            conn.close()
            raise HTTPException(404, "Upload not found")

        # For a direct student attempt (not an orchestrator spawn), enforce the
        # roster membership and the one-attempt-per-student rule. No time window.
        if not req.sub_agent_id:
            roll = student["roll_number"]
            on_roster = conn.execute(
                "SELECT 1 FROM event_students WHERE event_id=? AND roll_number=?",
                (req.event_id, roll),
            ).fetchone()
            if not on_roster:
                conn.close()
                raise HTTPException(403, "You are not assigned to this test.")
            # One attempt per EVENT — locked once a completed attempt (marks row) exists.
            # Keyed by event, not upload: several events can reuse the same content.
            already = conn.execute(
                """SELECT 1 FROM marks m JOIN viva_sessions s ON s.id = m.session_id
                   WHERE m.student_id=? AND s.event_id=?""",
                (req.student_id, req.event_id),
            ).fetchone()
            if already:
                conn.close()
                raise HTTPException(403, "You have already attempted this test.")

        upload_id      = req.upload_id
        active_slot_id = None

    # ── V1 student-upload start ─────────────────────────────────
    else:
        if not req.upload_id:
            conn.close()
            raise HTTPException(400, "Provide either upload_id or slot_id")
        upload = conn.execute("SELECT * FROM uploads WHERE id=? AND student_id=?",
                              (req.upload_id, req.student_id)).fetchone()
        if not upload:
            conn.close()
            raise HTTPException(404, "Upload not found")
        upload_id = req.upload_id
        active_slot_id = None

    if not upload["okf_ready"]:
        conn.close()
        raise HTTPException(400, "Knowledge base is not ready yet. Please wait for processing to complete.")

    graph = _load_graph(upload)
    if not graph or not graph.get("nodes"):
        conn.close()
        raise HTTPException(500, "Knowledge graph is missing or empty")

    session_id = str(uuid.uuid4())
    now = _now()

    conn.execute(
        """INSERT INTO viva_sessions
           (id,student_id,upload_id,slot_id,event_id,start_time,questions_asked,nodes_covered,
            tab_switch_count,warning_count,flagged,completed)
           VALUES (?,?,?,?,?,?,0,'[]',0,0,0,0)""",
        (session_id, req.student_id, upload_id,
         active_slot_id,
         slot["event_id"] if active_slot_id else req.event_id,
         now),
    )
    if active_slot_id:
        conn.execute(
            "UPDATE event_slots SET viva_session_id=? WHERE id=?",
            (session_id, active_slot_id)
        )
    conn.commit()
    conn.close()

    name          = student["name"]
    filename      = upload["filename"]
    graph_summary = _load_graph_summary(dict(upload))
    upload_row    = dict(upload)

    # Register with orchestrator if this came through the spawn flow
    if req.sub_agent_id:
        orch.register_active(
            session_id   = session_id,
            roll         = student["roll_number"],
            student_name = name,
            student_id   = req.student_id,
            sub_agent_id = req.sub_agent_id,
            event_id     = req.event_id or "",
            upload_id    = upload_id,
        )

    # MCQ viva: prefer the paper the professor pre-generated for THIS event
    # (instant, identical for every student, professor-chosen count + marks).
    # Fall back to the upload-level pre-gen, then on-demand generation.
    marks_per_question = 1
    mcq_questions = None
    if req.event_id:
        econn = get_conn()
        ev = econn.execute(
            "SELECT questions_json, marks_per_question FROM viva_events WHERE id=?",
            (req.event_id,),
        ).fetchone()
        econn.close()
        if ev:
            if ev["marks_per_question"]:
                marks_per_question = int(ev["marks_per_question"])
            if ev["questions_json"]:
                try:
                    loaded = json.loads(ev["questions_json"])
                    if isinstance(loaded, list) and loaded:
                        mcq_questions = loaded
                except Exception:
                    mcq_questions = None

    if not mcq_questions:
        mcq_questions = _load_mcq(upload_row)
    # Questions are generated only when the professor creates the event — never at viva start
    if not mcq_questions:
        conn = get_conn()
        conn.execute("DELETE FROM viva_sessions WHERE id=?", (session_id,))
        conn.commit(); conn.close()
        raise HTTPException(409, "This viva has no question paper. Ask your professor to recreate the event.")

    total_q = len(mcq_questions)
    total_marks = total_q * marks_per_question
    opening_line = (
        f"Multiple-choice test — {total_q} questions, {marks_per_question} "
        f"mark{'s' if marks_per_question != 1 else ''} each ({total_marks} total). "
        f"Select the best answer for each question."
    )
    first = mcq_questions[0]
    first_q = first["question"]

    _sessions[session_id] = {
        "student_id":    req.student_id,
        "upload_id":     upload_id,
        "student_name":  name,
        "filename":      filename,
        "graph":         graph,
        "graph_summary": graph_summary,
        "upload_row":    upload_row,
        # MCQ viva state
        "mcq_questions":        mcq_questions,
        "total_questions":      total_q,
        "marks_per_question":   marks_per_question,
        "total_marks":          total_marks,
        "correct_count":        0,
        "question_number":      1,      # current question (1-based)
        "exchange_count":       0,
        "conversation_history": [],
        "exchange_scores":      [],
        "session_start_epoch":  _time.time(),
        "hermes_session_id":    None,
        "visited":              [],
        "question_log":         [],
        "score_so_far":         0,
        "completed":            False,
        "last_question":        first_q,
    }

    return {
        "session_id":          session_id,
        "greeting_text":       opening_line,
        "first_question_text": first_q,
        "options":             first["options"],
        "question_number":     1,
        "total_questions":     total_q,
        "marks_per_question":  marks_per_question,
        "total_marks":         total_marks,
        "current_node":        f"Question 1 of {total_q}",
    }

# ──────────────────────────────────────────────────────────────
# SUBMIT ANSWER  (handles all student messages)
# ──────────────────────────────────────────────────────────────

class AnswerRequest(BaseModel):
    answer_text: str

@router.post("/answer/{session_id}")
async def submit_answer(session_id: str, req: AnswerRequest):
    state = _sessions.get(session_id)
    if not state:
        raise HTTPException(404, "Session not found or expired")
    if state["completed"]:
        raise HTTPException(400, "Session already completed")

    mcq = state.get("mcq_questions")
    if not mcq:
        raise HTTPException(400, "This session is not a multiple-choice viva.")

    current_q = state["question_number"]           # 1-based
    current   = mcq[current_q - 1]
    options   = current["options"]
    correct_index = current["correct_index"]

    mpq = state.get("marks_per_question", 1)

    # Parse the student's selected option (index/letter). Empty/invalid = no answer = wrong.
    selected = _parse_selection(req.answer_text, num_options=len(options))
    is_correct = (selected is not None and selected == correct_index)
    marks = mpq if is_correct else 0

    state["exchange_count"] += 1
    if is_correct:
        state["correct_count"] += 1

    score_entry = {"knowledge": marks, "understanding": marks, "application": marks}
    state["exchange_scores"].append(score_entry)

    explanation = current.get("explanation", "")
    state["question_log"].append({
        "question_number": current_q,
        "node":            f"Question {current_q}",
        "question":        current["question"],
        "options":         options,
        "answer":          req.answer_text.strip(),
        "selected_index":  selected,
        "correct_index":   correct_index,
        "correct_option":  options[correct_index],
        "is_correct":      is_correct,
        "explanation":     explanation,
        "feedback":        "Correct." if is_correct else f"Correct answer: {_LETTERS[correct_index]}. {options[correct_index]}",
        "marks_awarded":   marks,
        "level":           "medium",
        "is_followup":     False,
        **score_entry,
    })

    state["score_so_far"] = state["correct_count"] * mpq
    orch.update_progress(session_id, current_q, state["score_so_far"])

    # Flashcard shown after every answer (correct option + explanation).
    flashcard = {
        "question":       current["question"],
        "correct_letter": _LETTERS[correct_index],
        "correct_option": options[correct_index],
        "explanation":    explanation,
        "was_correct":    is_correct,
    }

    # Last question? Finalise with deterministic marks.
    if current_q >= state["total_questions"]:
        final = await _finalise_mcq(session_id, state)
        final["flashcard"] = flashcard
        final["was_correct"] = is_correct
        final["correct_index"] = correct_index
        final["correct_option"] = options[correct_index]
        final["marks_this_question"] = marks
        return final

    next_q_num = current_q + 1
    state["question_number"] = next_q_num
    nxt = mcq[next_q_num - 1]
    state["last_question"] = nxt["question"]

    return {
        "was_correct":         is_correct,
        "selected_index":      selected,
        "correct_index":       correct_index,
        "correct_option":      options[correct_index],
        "flashcard":           flashcard,
        "next_question_text":  nxt["question"],
        "options":             nxt["options"],
        "question_number":     next_q_num,
        "total_questions":     state["total_questions"],
        "score_so_far":        state["score_so_far"],
        "correct_count":       state["correct_count"],
        "marks_this_question": marks,
        "is_followup":         False,
        "viva_complete":       False,
        "current_node":        f"Question {next_q_num} of {state['total_questions']}",
    }


async def _finalise_mcq(session_id: str, state: dict) -> dict:
    """Deterministic finalisation for a multiple-choice viva (no LLM re-grade)."""
    state["completed"] = True
    name       = state["student_name"]
    filename   = state["filename"]
    student_id = state["student_id"]
    upload_id  = state["upload_id"]
    upload_row = state["upload_row"]

    total_q  = state["total_questions"]
    correct  = state["correct_count"]
    mpq      = state.get("marks_per_question", 1)
    obtained = correct * mpq
    max_marks = total_q * mpq
    pct      = (obtained / max_marks) if max_marks else 0.0
    grade    = _grade_pct(pct)

    wrong = [q for q in state["question_log"] if not q.get("is_correct")]
    strong_areas     = [] if wrong else ["Consistent accuracy across all questions"]
    areas_to_improve = [q["question"][:80] for q in wrong[:3]]
    comment = (f"Scored {obtained}/{max_marks} marks — "
               f"{correct} of {total_q} correct ({round(pct * 100)}%).")

    elapsed_seconds = _time.time() - state.get("session_start_epoch", _time.time())
    session_minutes = max(1, int(elapsed_seconds / 60))
    now = _now()

    marks_id = str(uuid.uuid4())
    conn = get_conn()
    conn.execute(
        """INSERT OR REPLACE INTO marks
           (id,student_id,upload_id,session_id,knowledge,understanding,confidence,
            application,contribution,total,grade,strong_areas,areas_to_improve,
            overall_comment,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (marks_id, student_id, upload_id, session_id,
         0, 0, 0, 0, 0, obtained, grade,
         json.dumps(strong_areas), json.dumps(areas_to_improve), comment, now),
    )
    conn.execute("UPDATE uploads SET viva_completed=1 WHERE id=?", (upload_id,))
    conn.execute(
        "UPDATE viva_sessions SET end_time=?,questions_asked=?,nodes_covered=?,"
        "completed=1,session_status='completed',question_log=? WHERE id=?",
        (now, state["exchange_count"], json.dumps(state.get("visited", [])),
         json.dumps(state.get("question_log", [])), session_id),
    )
    slot_row = conn.execute("SELECT slot_id FROM viva_sessions WHERE id=?", (session_id,)).fetchone()
    if slot_row and slot_row["slot_id"]:
        conn.execute("UPDATE event_slots SET status='completed' WHERE id=?", (slot_row["slot_id"],))
    conn.commit()
    conn.close()

    eval_result = {
        "student_name": name, "roll_number": student_id.split("_")[0],
        "upload_id": upload_id, "filename": filename, "date": now,
        "format": "mcq", "session_minutes": session_minutes,
        "questions": total_q, "correct": correct,
        "marks": {"obtained": obtained, "max": max_marks, "percent": round(pct * 100)},
        "grade": grade,
        "feedback": {"strong_areas": strong_areas, "areas_to_improve": areas_to_improve,
                     "overall_comment": comment},
        "question_log": state.get("question_log", []),
    }
    if upload_row.get("okf_bundle_path"):
        eval_dir = Path(upload_row["okf_bundle_path"]).parent / "evaluation"
        eval_dir.mkdir(exist_ok=True)
        (eval_dir / "result.json").write_text(json.dumps(eval_result, indent=2))

    orch.complete_session(session_id)

    closing = (
        f"Test complete, {name}. You answered {correct} of {total_q} correctly and "
        f"scored {obtained} out of {max_marks} marks — grade {grade}."
    )

    final = {
        "final_marks":      obtained,
        "max_marks":        max_marks,
        "percent":          round(pct * 100),
        "grade":            grade,
        "feedback":         comment,
        "strong_areas":     strong_areas,
        "areas_to_improve": areas_to_improve,
        "closing_text":     closing,
        "viva_complete":    True,
        "correct_count":    correct,
        "total_questions":  total_q,
        "marks_per_question": mpq,
        "student_id":   student_id,
        "upload_id":    upload_id,
        "filename":     filename,
        "student_name": name,
        "question_log": state.get("question_log", []),
    }
    state["final_result"] = final
    return final

def _phase_label(phase: str) -> str:
    # Legacy case interview labels kept for any old sessions
    legacy = {
        "presentation": "Case Presentation",
        "clarifying":   "Clarifying Questions",
        "framework":    "Framework",
        "analysis":     "Data Analysis",
        "solution":     "Solution Generation",
        "quant":        "Quantification",
        "recommendation": "Final Recommendation",
    }
    return legacy.get(phase, phase.replace("_", " ").title())

# ──────────────────────────────────────────────────────────────
# COMMAND (hint / skip / quit / repeat / time)
# ──────────────────────────────────────────────────────────────

class CommandRequest(BaseModel):
    command: str

@router.post("/command/{session_id}")
async def viva_command(session_id: str, req: CommandRequest):
    state = _sessions.get(session_id)
    if not state:
        raise HTTPException(404, "Session not found")

    cmd = req.command.lower().strip()

    if cmd == "repeat":
        # Repeat the last agent message
        last_agent = next(
            (t["content"] for t in reversed(state["conversation_history"]) if t["role"] == "agent"),
            "I asked you to share your thoughts on the case."
        )
        audio_bytes = await synthesize(last_agent)
        return {
            "agent_response_text": last_agent,
            "audio_b64": __import__("base64").b64encode(audio_bytes).decode(),
        }

    if cmd == "time":
        elapsed = int((_time.time() - state["session_start_epoch"]) / 60)
        msg = f"You have been going for {elapsed} minute{'s' if elapsed != 1 else ''}."
        audio_bytes = await synthesize(msg)
        return {
            "agent_response_text": msg,
            "audio_b64": __import__("base64").b64encode(audio_bytes).decode(),
        }

    if cmd == "hint":
        phase = state["phase"]
        hints_used = state.get("hints_used", {})
        if hints_used.get(phase, 0) >= 1:
            msg = "You have already used your hint for this phase. Try to work through it on your own."
            audio_bytes = await synthesize(msg)
            return {
                "agent_response_text": msg,
                "audio_b64": __import__("base64").b64encode(audio_bytes).decode(),
            }

        # Use the answer handler with hint flag
        last_student = next(
            (t["content"] for t in reversed(state["conversation_history"]) if t["role"] == "student"),
            "The student needs a hint."
        )
        result = await hermes_client.handle_viva_answer(
            student_answer    = last_student,
            question_number   = state["question_number"],
            hermes_session_id = state.get("hermes_session_id"),
            is_hint           = True,
            graph_summary     = state.get("graph_summary", ""),
            conversation_history = state.get("conversation_history", []),
        )
        if result.get("hermes_session_id"):
            state["hermes_session_id"] = result["hermes_session_id"]
        hint_response = result.get("response", "Think carefully about the key mechanism behind the concept.")
        hints_used[state["question_number"]] = hints_used.get(state["question_number"], 0) + 1
        state["hints_used"] = hints_used

        state["conversation_history"].append({"role": "agent", "content": hint_response})
        audio_bytes = await synthesize(hint_response)
        return {
            "agent_response_text": hint_response,
            "audio_b64": __import__("base64").b64encode(audio_bytes).decode(),
        }

    if cmd == "skip":
        # Advance by feeding a neutral placeholder into the exchange
        skip_req = AnswerRequest(answer_text="I would like to move on.")
        return await submit_answer(session_id, skip_req)

    if cmd == "quit":
        return await _finalise_viva(session_id, state, "You have chosen to end the session early.")

    raise HTTPException(400, f"Unknown command: {cmd}")

# ──────────────────────────────────────────────────────────────
# INTEGRITY
# ──────────────────────────────────────────────────────────────

class IntegrityEvent(BaseModel):
    event_type: str
    timestamp:  str

@router.post("/integrity/{session_id}")
async def log_integrity(session_id: str, ev: IntegrityEvent):
    state = _sessions.get(session_id)
    conn = get_conn()

    conn.execute(
        "INSERT INTO integrity_log (id,session_id,event_type,timestamp) VALUES (?,?,?,?)",
        (str(uuid.uuid4()), session_id, ev.event_type, ev.timestamp),
    )

    if ev.event_type in ("tab_switch", "blur", "visibility_hidden"):
        conn.execute(
            "UPDATE viva_sessions SET tab_switch_count=tab_switch_count+1, "
            "warning_count=warning_count+1 WHERE id=?", (session_id,)
        )
        if state:
            state["warning_count"] = state.get("warning_count", 0) + 1

    row = conn.execute(
        "SELECT warning_count FROM viva_sessions WHERE id=?", (session_id,)
    ).fetchone()
    warning_count = row["warning_count"] if row else 0
    flagged = warning_count >= 3

    if flagged:
        conn.execute("UPDATE viva_sessions SET flagged=1 WHERE id=?", (session_id,))

    conn.commit()
    conn.close()
    return {"warning_count": warning_count, "flagged": flagged}

# ──────────────────────────────────────────────────────────────
# END VIVA
# ──────────────────────────────────────────────────────────────

@router.post("/end/{session_id}")
async def end_viva(session_id: str):
    state = _sessions.get(session_id)
    if not state:
        raise HTTPException(404, "Session not found")
    return await _finalise_viva(session_id, state, "")

@router.get("/end/{session_id}")
async def get_end_viva(session_id: str):
    state = _sessions.get(session_id)
    if not state:
        raise HTTPException(404, "Session not found")
    if not state.get("completed"):
        raise HTTPException(400, "Session not yet completed")
    return state.get("final_result", {})

# ──────────────────────────────────────────────────────────────
# INTERNAL — finalise
# ──────────────────────────────────────────────────────────────

async def _finalise_viva(session_id: str, state: dict, prefix_feedback: str) -> dict:
    state["completed"] = True
    name          = state["student_name"]
    filename      = state["filename"]
    student_id    = state["student_id"]
    upload_id     = state["upload_id"]
    upload_row    = state["upload_row"]
    exchange_scores = state.get("exchange_scores", [])
    graph_summary   = state.get("graph_summary", _load_graph_summary(upload_row))
    conv_history    = state.get("conversation_history", [])

    elapsed_seconds  = _time.time() - state.get("session_start_epoch", _time.time())
    session_minutes  = max(1, int(elapsed_seconds / 60))

    questions_answered = state.get("exchange_count", len(exchange_scores))

    evaluation = await hermes_client.generate_viva_evaluation(
        student_name       = name,
        session_minutes    = session_minutes,
        exchange_scores    = exchange_scores,
        hermes_session_id  = state.get("hermes_session_id"),
        questions_answered = questions_answered,
        question_log       = state.get("question_log", []),
    )

    total = sum([
        evaluation.get("knowledge", 0),
        evaluation.get("understanding", 0),
        evaluation.get("application", 0),
    ])
    grade = _grade(total)

    strong_areas     = evaluation.get("strong_areas", [])
    areas_to_improve = evaluation.get("areas_to_improve", [])
    comment          = evaluation.get("overall_comment", "")

    now = _now()

    marks_id = str(uuid.uuid4())
    conn = get_conn()
    conn.execute(
        """INSERT OR REPLACE INTO marks
           (id,student_id,upload_id,session_id,knowledge,understanding,confidence,
            application,contribution,total,grade,strong_areas,areas_to_improve,
            overall_comment,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            marks_id, student_id, upload_id, session_id,
            evaluation.get("knowledge", 0),
            evaluation.get("understanding", 0),
            0,
            evaluation.get("application", 0),
            0,
            total, grade,
            json.dumps(strong_areas),
            json.dumps(areas_to_improve),
            comment, now,
        )
    )
    conn.execute("UPDATE uploads SET viva_completed=1 WHERE id=?", (upload_id,))
    conn.execute(
        "UPDATE viva_sessions SET end_time=?,questions_asked=?,nodes_covered=?,"
        "completed=1,session_status='completed' WHERE id=?",
        (now, state["exchange_count"], json.dumps(state.get("visited", [])), session_id)
    )
    slot_row = conn.execute("SELECT slot_id FROM viva_sessions WHERE id=?", (session_id,)).fetchone()
    if slot_row and slot_row["slot_id"]:
        conn.execute("UPDATE event_slots SET status='completed' WHERE id=?", (slot_row["slot_id"],))
    conn.commit()
    conn.close()

    # Save evaluation JSON alongside the OKF bundle
    eval_result = {
        "student_name":    name,
        "roll_number":     student_id.split("_")[0],
        "upload_id":       upload_id,
        "filename":        filename,
        "date":            now,
        "case_type":       state.get("case_type", ""),
        "scenario_type":   "From uploaded content" if state.get("scenario_type") == "A" else "Agent-created",
        "session_minutes": session_minutes,
        "exchanges":       state["exchange_count"],
        "marks": {
            "knowledge":             evaluation.get("knowledge", 0),
            "understanding":         evaluation.get("understanding", 0),
            "application":           evaluation.get("application", 0),
            "total":                 total,
        },
        "grade": grade,
        "feedback": {
            "strong_areas":     strong_areas,
            "areas_to_improve": areas_to_improve,
            "overall_comment":  comment,
        },
        "milestones": {
            "has_framework":      state.get("has_framework", False),
            "has_calculation":    state.get("has_calculation", False),
            "has_recommendation": state.get("has_recommendation", False),
        },
        "conversation_history": conv_history,
    }

    if upload_row.get("okf_bundle_path"):
        eval_dir = Path(upload_row["okf_bundle_path"]).parent / "evaluation"
        eval_dir.mkdir(exist_ok=True)
        (eval_dir / "result.json").write_text(json.dumps(eval_result, indent=2))

    # Release the orchestrator slot so next queued student can enter
    orch.complete_session(session_id)

    # Use Hermes-generated debrief text if available, otherwise build it
    hermes_closing = evaluation.get("closing_text", "").strip()
    if hermes_closing:
        closing = (f"{prefix_feedback} {hermes_closing}").strip()
    else:
        strong_str  = " and ".join(strong_areas[:2])  if strong_areas     else "your depth of knowledge"
        improve_str = " and ".join(areas_to_improve[:2]) if areas_to_improve else "elaboration and precision"
        closing = (
            f"{prefix_feedback} "
            f"Examination complete. Here is your debrief, {name}. "
            f"Session time: {session_minutes} minutes. "
            f"Your final score is {total} out of thirty, which gives you a grade of {grade}. "
            f"What you did well: {strong_str}. "
            f"Focus for next session: {improve_str}. "
            f"{comment} "
            f"All the best!"
        ).strip()

    audio_bytes = await synthesize(closing)
    audio_b64   = __import__("base64").b64encode(audio_bytes).decode()

    final = {
        "final_marks":      total,
        "grade":            grade,
        "feedback":         comment,
        "strong_areas":     strong_areas,
        "areas_to_improve": areas_to_improve,
        "closing_text":     closing,
        "audio_b64":        audio_b64,
        "viva_complete":    True,
        "marks_breakdown": {
            "knowledge":        evaluation.get("knowledge", 0),
            "understanding":    evaluation.get("understanding", 0),
            "confidence":       evaluation.get("confidence", 0),
            "application":      evaluation.get("application", 0),
            "contribution":     evaluation.get("contribution", 0),
        },
        "student_id":    student_id,
        "upload_id":     upload_id,
        "filename":      filename,
        "student_name":  name,
        "question_log":  state.get("question_log", []),
    }
    state["final_result"] = final
    return final


# ──────────────────────────────────────────────────────────────
# JOIN  (orchestrator entry point — roll number + name only)
# ──────────────────────────────────────────────────────────────

def _compute_sub_slots(start_time: str, end_time: str) -> list[dict]:
    """Return 15-min sub-slot boundaries between start and end."""
    def to_mins(t: str) -> int:
        h, m = map(int, t.split(":"))
        return h * 60 + m
    def from_mins(m: int) -> str:
        h, mn = divmod(m, 60)
        return f"{h:02d}:{mn:02d}"
    def fmt12(t: str) -> str:
        h, m = map(int, t.split(":"))
        suffix = "AM" if h < 12 else "PM"
        h12 = h % 12 or 12
        return f"{h12}:{m:02d} {suffix}"

    slots = []
    cur = to_mins(start_time)
    end = to_mins(end_time)
    while cur < end:
        nxt = cur + 15
        slots.append({
            "start": from_mins(cur),
            "end":   from_mins(min(nxt, end)),
            "label": fmt12(from_mins(cur)),
        })
        cur = nxt
    return slots


@router.get("/event-info")
async def get_event_info(roll_number: str):
    """Return a list of event details + sub-slot lists for a student."""
    roll = roll_number.strip().upper()
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
        raise HTTPException(
            404,
            "No scheduled viva found for your roll number. "
            "Please ask your professor to check the event roster.",
        )

    out = []
    for r in rows:
        sub_slots = _compute_sub_slots(r["start_time"], r["end_time"])
        out.append({
            "event_id":    r["event_id"],
            "title":       r["title"],
            "event_date":  r["event_date"],
            "start_time":  r["start_time"],
            "end_time":    r["end_time"],
            "max_students": int(r["max_students"]),
            "upload_id":   r["upload_id"],
            "sub_slots":   sub_slots,
        })
    return out


class JoinRequest(BaseModel):
    roll_number:  str
    student_name: str
    event_id:     Optional[str] = None

@router.post("/join")
async def join_viva(req: JoinRequest):
    """
    Students call this with just their roll number + name.
    Returns ready (slot available) or queued (max 10 active).
    """
    roll = req.roll_number.strip().upper()
    name = req.student_name.strip()

    conn = get_conn()
    student = conn.execute(
        "SELECT * FROM students WHERE roll_number=?", (roll,)
    ).fetchone()
    conn.close()
    if not student:
        raise HTTPException(404, "Roll number not found. Please contact your professor.")

    student_id = student["id"]

    # Already in an active session
    active = orch.is_already_active(roll)
    if active:
        return {
            "status":     "active",
            "session_id": active["session_id"],
            "student_id": student_id,
            "message":    f"Welcome back, {name}! Resuming your session.",
        }

    event_id = req.event_id
    if event_id:
        conn = get_conn()
        event_row = conn.execute("""
            SELECT ve.id AS event_id, ve.upload_id, ve.title, ve.event_date, ve.start_time, ve.end_time,
                   COALESCE(ve.max_students, 10) AS max_students
            FROM viva_events ve
            WHERE ve.id = ?
        """, (event_id,)).fetchone()
        conn.close()
        if not event_row:
            raise HTTPException(404, f"Event {event_id} not found")
        event_info = dict(event_row)
    else:
        event_info = orch.find_event_for_student(roll)

    if not event_info:
        raise HTTPException(
            404,
            "No active viva event found for your roll number. "
            "Please ask your professor to check the event roster.",
        )

    event_id  = event_info["event_id"]
    upload_id = event_info["upload_id"]

    # Idempotent: already reserved → return ready without consuming another slot
    if orch.is_already_reserved(roll):
        return {
            "status":        "ready",
            "student_id":    student_id,
            "upload_id":     upload_id,
            "event_id":      event_id,
            "sub_agent_id":  f"agent-{str(uuid.uuid4())[:8]}",
            "student_name":  name,
            "content_title": event_info.get("title", ""),
            "message":       f"Welcome back, {name}! Resuming your slot.",
        }

    max_students = int(event_info.get("max_students") or 10)
    if orch.can_spawn(max_students):
        orch.reserve_slot(roll)
        return {
            "status":        "ready",
            "student_id":    student_id,
            "upload_id":     upload_id,
            "event_id":      event_id,
            "sub_agent_id":  f"agent-{str(uuid.uuid4())[:8]}",
            "student_name":  name,
            "content_title": event_info.get("title", ""),
            "message":       f"Welcome, {name}! Your examiner is ready.",
        }

    active_count = orch.get_status()["active_count"]
    raise HTTPException(
        409,
        f"All {max_students} viva slots are currently occupied ({active_count} active, "
        f"{orch.get_status()['reserved_count']} joining). "
        "Please wait a few minutes and try again, or contact your professor.",
    )
