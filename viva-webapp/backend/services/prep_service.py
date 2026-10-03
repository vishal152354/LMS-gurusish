"""
Viva Prep — generates flashcards and MCQs from an upload's OKF bundle.

Content is generated once per upload (by the same LLM the viva uses) and cached
in prep_items. Generation runs in the background; callers poll prep_sets.status.
"""
import re, json, uuid, random, asyncio, logging
from datetime import datetime
from pathlib import Path

from ..database.db import get_conn
from .hermes_client import hermes_client

_log = logging.getLogger("prep_service")

CHUNK_CHARS      = 3000   # report text per LLM call
FLASHCARD_TARGET = 20
MCQ_TARGET       = 15
MAX_CHUNKS       = 8

_running: set[str] = set()   # upload_ids with a generation task in this process

SYSTEM_PROMPT = (
    "You write viva voce preparation material for university students. "
    "You only use facts stated in the study material you are given. "
    "You always reply with a single JSON object and nothing else."
)


def _now() -> str:
    return datetime.utcnow().isoformat()


# ── source text ───────────────────────────────────────────────

def _strip_note(md: str) -> str:
    """Body of an OKF concept note: drop frontmatter, related-concept links, key-point echo."""
    if md.startswith("---"):
        end = md.find("\n---", 3)
        if end != -1:
            md = md[end + 4:]
    md = re.split(r"\n##\s+(Related Concepts|Key Points)\b", md)[0]
    md = re.sub(r"[ \t]+", " ", md)
    md = re.sub(r"\n\s*\n+", "\n", md)
    return md.strip()


def _load_source_text(upload_row) -> str:
    bundle = upload_row["okf_bundle_path"]
    graph_path = upload_row["graph_path"]
    if not bundle or not Path(bundle).exists():
        return ""
    node_ids = []
    if graph_path and Path(graph_path).exists():
        try:
            node_ids = [n["id"] for n in json.loads(Path(graph_path).read_text()).get("nodes", [])]
        except Exception:
            node_ids = []
    if not node_ids:
        node_ids = [p.stem for p in sorted(Path(bundle).glob("*.md")) if p.stem not in ("index", "log")]
    parts = []
    for nid in node_ids:
        f = Path(bundle) / f"{nid}.md"
        if f.exists():
            body = _strip_note(f.read_text())
            if len(body) > 80:
                parts.append(body)
    return "\n\n".join(parts)


def _chunk(text: str) -> list[str]:
    chunks, cur = [], ""
    for para in text.split("\n"):
        if len(cur) + len(para) > CHUNK_CHARS and cur:
            chunks.append(cur)
            cur = ""
        cur += para + "\n"
    if cur.strip():
        chunks.append(cur)
    return chunks[:MAX_CHUNKS]


# ── LLM call + validation ────────────────────────────────────

def _prompt(chunk: str, n_cards: int, n_mcqs: int) -> str:
    return (
        "STUDY MATERIAL:\n---\n" + chunk + "\n---\n\n"
        f"Write {n_cards} flashcards and {n_mcqs} multiple-choice questions that an examiner "
        "could ask in a viva about this material.\n"
        "Rules:\n"
        "- Use only facts from the study material. Skip college names, lab rules, dress codes and other administrative text.\n"
        "- Flashcard question: a spoken-style viva question. Answer: 1-3 clear sentences.\n"
        "- explanation: one short examiner tip (what a strong answer should mention).\n"
        "- topic: a short 2-4 word label for the concept (e.g. \"Ohm's law\").\n"
        "- MCQ: exactly 4 distinct options, exactly one correct. correct_index is 0-3.\n"
        "- difficulty: easy, medium or hard.\n"
        "Reply with ONLY this JSON:\n"
        '{"flashcards":[{"topic":"","question":"","answer":"","explanation":"","difficulty":"medium"}],'
        '"mcqs":[{"topic":"","question":"","options":["","","",""],"correct_index":0,"explanation":"","difficulty":"medium"}]}'
    )


def _clean(s) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def _valid_flashcard(fc) -> dict | None:
    if not isinstance(fc, dict):
        return None
    q, a = _clean(fc.get("question")), _clean(fc.get("answer"))
    if len(q) < 8 or len(a) < 3:
        return None
    return {
        "topic": _clean(fc.get("topic"))[:60] or "General",
        "question": q,
        "answer": a,
        "explanation": _clean(fc.get("explanation")),
        "difficulty": _clean(fc.get("difficulty")).lower() if _clean(fc.get("difficulty")).lower() in ("easy", "medium", "hard") else "medium",
    }


def _valid_mcq(m) -> dict | None:
    if not isinstance(m, dict):
        return None
    q = _clean(m.get("question"))
    opts = [_clean(o) for o in (m.get("options") or []) if _clean(o)]
    try:
        ci = int(m.get("correct_index"))
    except Exception:
        return None
    if len(q) < 8 or len(opts) != 4 or len({o.lower() for o in opts}) != 4 or not 0 <= ci <= 3:
        return None
    # Shuffle so the correct answer isn't always in the model's favourite position
    correct = opts[ci]
    random.shuffle(opts)
    return {
        "topic": _clean(m.get("topic"))[:60] or "General",
        "question": q,
        "options": opts,
        "correct_index": opts.index(correct),
        "explanation": _clean(m.get("explanation")),
        "difficulty": _clean(m.get("difficulty")).lower() if _clean(m.get("difficulty")).lower() in ("easy", "medium", "hard") else "medium",
    }


async def _generate_chunk(chunk: str, n_cards: int, n_mcqs: int) -> tuple[list, list]:
    for attempt in range(2):
        try:
            text, _ = await hermes_client._hermes_api(
                _prompt(chunk, n_cards, n_mcqs), system=SYSTEM_PROMPT,
                timeout=300, max_tokens=3000,
            )
        except Exception as e:
            _log.warning("prep chunk LLM call failed (attempt %d): %s", attempt + 1, e)
            continue
        _, data = hermes_client._extract_json_block(text)
        cards = [c for c in map(_valid_flashcard, data.get("flashcards") or []) if c]
        mcqs  = [m for m in map(_valid_mcq, data.get("mcqs") or []) if m]
        if cards or mcqs:
            return cards, mcqs
        _log.warning("prep chunk returned no usable items (attempt %d): %s", attempt + 1, text[:300])
    return [], []


# ── job control ──────────────────────────────────────────────

def _set_status(upload_id: str, **fields):
    fields["updated_at"] = _now()
    conn = get_conn()
    conn.execute("INSERT OR IGNORE INTO prep_sets (upload_id) VALUES (?)", (upload_id,))
    conn.execute(
        f"UPDATE prep_sets SET {', '.join(f'{k}=?' for k in fields)} WHERE upload_id=?",
        (*fields.values(), upload_id),
    )
    conn.commit()
    conn.close()


def get_status(upload_id: str) -> dict:
    conn = get_conn()
    row = conn.execute("SELECT * FROM prep_sets WHERE upload_id=?", (upload_id,)).fetchone()
    conn.close()
    if not row:
        return {"status": "pending", "done_chunks": 0, "total_chunks": 0, "error": None}
    st = dict(row)
    # A 'generating' row with no live task means the server restarted mid-job
    if st["status"] == "generating" and upload_id not in _running:
        st["status"] = "failed"
        st["error"] = st.get("error") or "Generation was interrupted. Please try again."
    return st


def ensure_generation(upload_id: str, upload_row) -> dict:
    """Start background generation unless content is ready or already being generated."""
    st = get_status(upload_id)
    if st["status"] == "ready" or upload_id in _running:
        return get_status(upload_id)
    _running.add(upload_id)
    _set_status(upload_id, status="generating", done_chunks=0, total_chunks=0, error=None)
    asyncio.create_task(_run(upload_id, dict(upload_row)))
    return get_status(upload_id)


async def _run(upload_id: str, upload_row: dict):
    try:
        chunks = _chunk(_load_source_text(upload_row))
        if not chunks:
            _set_status(upload_id, status="failed", error="No study material found for this report.")
            return
        _set_status(upload_id, total_chunks=len(chunks))
        n_cards = max(2, min(6, -(-FLASHCARD_TARGET // len(chunks))))
        n_mcqs  = max(2, min(5, -(-MCQ_TARGET // len(chunks))))

        cards, mcqs, seen = [], [], set()
        for i, chunk in enumerate(chunks):
            c, m = await _generate_chunk(chunk, n_cards, n_mcqs)
            for item, bucket in [(x, cards) for x in c] + [(x, mcqs) for x in m]:
                key = re.sub(r"\W+", "", item["question"].lower())
                if key not in seen:
                    seen.add(key)
                    bucket.append(item)
            _set_status(upload_id, done_chunks=i + 1)

        if not cards and not mcqs:
            _set_status(upload_id, status="failed",
                        error="The AI model could not generate practice material. Check that the model server is running, then try again.")
            return

        conn = get_conn()
        conn.execute("DELETE FROM prep_items WHERE upload_id=?", (upload_id,))
        for kind, items in (("flashcard", cards[:FLASHCARD_TARGET]), ("mcq", mcqs[:MCQ_TARGET])):
            for pos, it in enumerate(items):
                conn.execute(
                    """INSERT INTO prep_items (id, upload_id, kind, position, topic, question, answer,
                       explanation, options, correct_index, difficulty, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (str(uuid.uuid4()), upload_id, kind, pos, it["topic"], it["question"],
                     it.get("answer"), it["explanation"],
                     json.dumps(it["options"]) if kind == "mcq" else None,
                     it.get("correct_index"), it["difficulty"], _now()),
                )
        conn.commit()
        conn.close()
        _set_status(upload_id, status="ready", error=None)
        _log.info("prep ready for %s: %d flashcards, %d mcqs", upload_id, len(cards), len(mcqs))
    except Exception as e:
        _log.exception("prep generation failed for %s", upload_id)
        _set_status(upload_id, status="failed", error=f"Generation failed: {e}")
    finally:
        _running.discard(upload_id)


def load_items(upload_id: str) -> tuple[list, list]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM prep_items WHERE upload_id=? ORDER BY kind, position", (upload_id,)
    ).fetchall()
    conn.close()
    flashcards, mcqs = [], []
    for r in rows:
        base = {"id": r["id"], "subjectId": upload_id, "topic": r["topic"],
                "question": r["question"], "explanation": r["explanation"],
                "difficulty": r["difficulty"]}
        if r["kind"] == "flashcard":
            flashcards.append({**base, "answer": r["answer"]})
        else:
            mcqs.append({**base, "options": json.loads(r["options"] or "[]"),
                         "correctAnswer": r["correct_index"]})
    return flashcards, mcqs
