"""
Question-paper generation: MCQ, fill in the blanks, match the following.

The knowledge graph's concepts are spread across small batches that run in
parallel (each batch is one model call), so a paper takes about as long as a
single call. Every question is validated before it is kept; batches that come
back short are retried once.

Stored question shapes (questions_json on viva_events):
  {"type":"mcq",        "question", "options":[4], "correct_index", "explanation"}
  {"type":"fill_blank", "question" (one "____"), "answer", "alternatives":[...], "explanation"}
  {"type":"match",      "question", "left":[n], "right":[n] (right[i] matches left[i]), "explanation"}
"""
import asyncio, json, logging, random, re

_log = logging.getLogger("question_gen")

TYPES = ("mcq", "fill_blank", "match")
BATCH_SIZE = {"mcq": 5, "fill_blank": 5, "match": 2}
MAX_PARALLEL = 4            # OpenRouter free tier allows 20 requests/minute
BLANK = "____"

SYSTEM = (
    "You are an examiner writing questions for a test. Use ONLY facts stated in the source. "
    "Ask about the subject matter itself — never about the document, its headings, sections, "
    "concepts or structure, and never about email addresses, phone numbers or page details. "
    "Reply with ONLY a JSON array — no prose, no markdown fences."
)

INSTRUCTIONS = {
    "mcq": (
        "Write {n} multiple-choice questions of medium difficulty that test understanding, not trivia.\n"
        "- exactly 4 short, distinct options; exactly one correct; vary the correct position\n"
        "- wrong options plausible but clearly wrong according to the source\n"
        "- explanation: one sentence on why the correct option is right\n"
        'Each object: {{"question":"...","options":["...","...","...","..."],"correct_index":0,"explanation":"..."}}'
    ),
    "fill_blank": (
        "Write {n} fill-in-the-blank questions.\n"
        "For each, write ONE complete, natural sentence (8 to 25 words) stating a fact from the source, "
        "and pick ONE key term from that sentence (1 to 3 words) for the student to fill in.\n"
        "- the term must appear in the sentence exactly as written, and only once\n"
        "- choose a term a student could only answer if they know the material (a name, value, method, part)\n"
        "- do NOT copy headings, lists, emails or phone numbers; write a proper sentence\n"
        "- alternatives: other accepted forms of the term (may be empty)\n"
        'Each object: {{"sentence":"A rheostat is used to vary the current in the circuit.","answer":"rheostat","alternatives":[],"explanation":"..."}}'
    ),
    "match": (
        "Write {n} match-the-following questions. Each pairs 4 terms with their matching descriptions.\n"
        "- left: 4 short terms; right: their 4 matches IN THE SAME ORDER (right[i] matches left[i])\n"
        "- every pair is unambiguous and stated in the source; keep each item under 8 words\n"
        "- question: a one-line instruction, e.g. \"Match each instrument with what it measures.\"\n"
        'Each object: {{"question":"Match each ...","left":["...","...","...","..."],"right":["...","...","...","..."],"explanation":"..."}}'
    ),
}


# ── validation ────────────────────────────────────────────────

def _clean(s) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


_META = re.compile(r"@|\bconcept[- ]?\d|\bconcept '|knowledge graph|\bsection\b|\bheading\b|\bthe source\b|\bthe document\b|\d{7,}", re.I)


def _is_meta(*texts) -> bool:
    """Questions about the document itself, or that quote contact details."""
    return any(_META.search(t or "") for t in texts)


def _key(q: dict) -> str:
    return re.sub(r"\W+", "", q.get("question", "").lower())


def _valid_mcq(o: dict):
    q = _clean(o.get("question") or o.get("stem"))
    opts = [_clean(x) for x in (o.get("options") or o.get("choices") or [])][:4]
    try:
        ci = int(o.get("correct_index", o.get("answer_index")))
    except Exception:
        return None
    if len(q) < 8 or len(opts) != 4 or not all(opts) or len({x.lower() for x in opts}) != 4 or not 0 <= ci <= 3:
        return None
    if _is_meta(q, *opts):
        return None
    correct = opts[ci]
    random.shuffle(opts)                      # models favour position A
    return {"type": "mcq", "question": q, "options": opts, "correct_index": opts.index(correct),
            "explanation": _clean(o.get("explanation"))}


def _valid_fill(o: dict):
    ans = _clean(o.get("answer"))
    alts = [_clean(a) for a in (o.get("alternatives") or []) if _clean(a)]
    sentence = _clean(o.get("sentence"))
    if sentence and ans:
        # We make the blank ourselves: the term must occur exactly once, as whole words
        hits = list(re.finditer(rf"(?<!\w){re.escape(ans)}(?!\w)", sentence, flags=re.I))
        if len(hits) != 1:
            return None
        h = hits[0]
        ans = sentence[h.start():h.end()]
        q = sentence[:h.start()] + BLANK + sentence[h.end():]
    else:                                     # model already wrote the blank
        q = _clean(o.get("question"))
        q = re.sub(r"_{2,}|\[\s*blank\s*\]|\(\s*blank\s*\)|\.{4,}", BLANK, q, flags=re.I)
    words = len(q.split())
    if q.count(BLANK) != 1 or not ans or len(ans.split()) > 4 or words < 6 or words > 40:
        return None
    if _is_meta(q, ans):
        return None                           # about the document / contact details, not a fact
    if ans.lower() in q.lower().replace(BLANK.lower(), ""):
        return None                           # answer leaked into the sentence
    return {"type": "fill_blank", "question": q, "answer": ans, "alternatives": alts[:5],
            "explanation": _clean(o.get("explanation"))}


def _valid_match(o: dict):
    q = _clean(o.get("question")) or "Match each item on the left with the right one."
    left = [_clean(x) for x in (o.get("left") or [])]
    right = [_clean(x) for x in (o.get("right") or [])]
    if not left and isinstance(o.get("pairs"), list):
        left = [_clean(p.get("left")) for p in o["pairs"] if isinstance(p, dict)]
        right = [_clean(p.get("right")) for p in o["pairs"] if isinstance(p, dict)]
    n = min(len(left), len(right))
    left, right = left[:n], right[:n]
    if n < 3 or not all(left) or not all(right):
        return None
    if len({x.lower() for x in left}) != n or len({x.lower() for x in right}) != n:
        return None
    if _is_meta(q, *left, *right):
        return None
    return {"type": "match", "question": q, "left": left[:5], "right": right[:5],
            "explanation": _clean(o.get("explanation"))}


VALIDATE = {"mcq": _valid_mcq, "fill_blank": _valid_fill, "match": _valid_match}


def _parse_array(text: str) -> list:
    text = re.sub(r"```(?:json)?", "", text or "")
    start, end = text.find("["), text.rfind("]")
    if start != -1 and end > start:
        try:
            data = json.loads(text[start:end + 1])
            if isinstance(data, list):
                return [x for x in data if isinstance(x, dict)]
        except Exception:
            pass
    # salvage objects one by one when the array is malformed
    out = []
    for m in re.finditer(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", text):
        try:
            o = json.loads(m.group(0))
            if isinstance(o, dict):
                out.append(o)
        except Exception:
            continue
    return out


# ── generation ────────────────────────────────────────────────

def _focus_groups(graph: dict, k: int) -> list[list[str]]:
    """Spread the knowledge graph's concept titles over k batches."""
    titles = [_clean(n.get("title")) for n in (graph or {}).get("nodes", []) if _clean(n.get("title"))]
    groups = [[] for _ in range(max(1, k))]
    for i, t in enumerate(titles):
        groups[i % len(groups)].append(t)
    return groups


async def generate_paper(client, graph: dict, summary: str, counts: dict, on_progress=None) -> list:
    """Generate the paper. `counts` = {"mcq": n, "fill_blank": n, "match": n}."""
    counts = {t: max(0, int(counts.get(t, 0) or 0)) for t in TYPES}
    source = (summary or json.dumps(graph or {}))[:8000]

    batches = []                              # (type, size)
    for t in TYPES:
        left = counts[t]
        while left > 0:
            size = min(BATCH_SIZE[t], left)
            batches.append((t, size))
            left -= size
    if not batches:
        return []

    groups = _focus_groups(graph, len(batches))
    done = 0
    sem = asyncio.Semaphore(MAX_PARALLEL)
    total_batches = len(batches)

    def report(stage, **extra):
        if on_progress:
            try:
                on_progress(stage, {"done": done, "total": total_batches, **extra})
            except Exception:
                pass

    async def run_batch(i, qtype, size, focus):
        nonlocal done
        hint = f"Focus on these concepts where possible: {'; '.join(focus)}.\n" if focus else ""
        ask = size + 1                        # one spare, so a rejected question doesn't leave the paper short
        msg = (INSTRUCTIONS[qtype].format(n=ask) + "\n" + hint +
               f"Return ONLY a JSON array of exactly {ask} objects.\n\nSOURCE:\n{source}")
        max_tokens = 400 * ask + 300
        got = []
        for attempt in range(2):
            async with sem:
                try:
                    # fast first; if that fails validation, let the model think on the retry
                    text, _ = await client._hermes_api(msg, system=SYSTEM, max_tokens=max_tokens * (1 if attempt == 0 else 3),
                                                       timeout=90 if attempt == 0 else 150, fast=attempt == 0)
                    got = [q for q in map(VALIDATE[qtype], _parse_array(text)) if q]
                except Exception as e:
                    _log.warning("%s batch %d attempt %d failed: %s", qtype, i, attempt + 1, e)
                    got = []
            if len(got) >= size:
                break
            _log.warning("%s batch %d attempt %d gave %d/%d valid", qtype, i, attempt + 1, len(got), size)
        done += 1
        report("generating")
        return qtype, got[:size]

    report("generating")
    results = await asyncio.gather(*[run_batch(i, t, n, groups[i] if i < len(groups) else [])
                                     for i, (t, n) in enumerate(batches)])

    # merge by type, drop duplicates, keep the requested counts
    report("checking")
    by_type = {t: [] for t in TYPES}
    seen = set()
    for qtype, qs in results:
        for q in qs:
            k = _key(q)
            if k and k not in seen:
                seen.add(k)
                by_type[qtype].append(q)

    # one top-up round for any type that came back short
    short = {t: counts[t] - len(by_type[t]) for t in TYPES if len(by_type[t]) < counts[t]}
    if short:
        _log.info("topping up: %s", short)
        total_batches += len(short)
        report("generating")
        extra = await asyncio.gather(*[run_batch(100 + j, t, n, []) for j, (t, n) in enumerate(short.items())])
        for qtype, qs in extra:
            for q in qs:
                k = _key(q)
                if k and k not in seen and len(by_type[qtype]) < counts[qtype]:
                    seen.add(k)
                    by_type[qtype].append(q)

    paper = [q for t in TYPES for q in by_type[t][:counts[t]]]
    _log.info("paper: %s", {t: len(by_type[t][:counts[t]]) for t in TYPES})
    return paper


# ── serving and marking ───────────────────────────────────────

def qtype(q: dict) -> str:
    return q.get("type") or "mcq"


def public_view(q: dict, right_order: list | None = None) -> dict:
    """What the student sees — never the answer."""
    t = qtype(q)
    if t == "mcq":
        return {"type": "mcq", "question": q["question"], "options": q["options"]}
    if t == "fill_blank":
        return {"type": "fill_blank", "question": q["question"]}
    order = right_order or list(range(len(q["right"])))
    return {"type": "match", "question": q["question"], "left": q["left"],
            "right": [q["right"][i] for i in order]}


def _norm(s: str) -> str:
    s = (s or "").lower().strip()
    s = re.sub(r"[^\w\s.%-]", "", s)
    s = re.sub(r"\b(the|a|an)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _close(a: str, b: str) -> bool:
    """Equal, or one typo apart for words of 5+ letters."""
    if a == b:
        return True
    if min(len(a), len(b)) < 5 or abs(len(a) - len(b)) > 1:
        return False
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1] <= 1


def mark(q: dict, *, text: str | None, match: list | None, right_order: list | None,
         mpq: float, letters: list, parse_selection) -> dict:
    """Mark one answer. Returns the question-log fields for it."""
    t = qtype(q)
    base = {"type": t, "question": q["question"], "explanation": q.get("explanation", ""), "max_marks": mpq}

    if t == "mcq":
        sel = parse_selection(text or "", num_options=len(q["options"]))
        ci = q["correct_index"]
        ok = sel is not None and sel == ci
        return {**base, "options": q["options"], "answer": (text or "").strip(),
                "selected_index": sel, "correct_index": ci, "correct_option": q["options"][ci],
                "student_answer": q["options"][sel] if sel is not None else None,
                "correct_answer": q["options"][ci], "is_correct": ok, "marks_awarded": mpq if ok else 0}

    if t == "fill_blank":
        given = (text or "").strip()
        accepted = [q["answer"], *q.get("alternatives", [])]
        ok = bool(given) and any(_close(_norm(given), _norm(a)) for a in accepted)
        return {**base, "student_answer": given or None, "correct_answer": q["answer"],
                "correct_option": q["answer"], "accepted_answers": accepted,
                "is_correct": ok, "marks_awarded": mpq if ok else 0}

    # match: `match[i]` = index (in the shuffled right column) chosen for left[i]
    order = right_order or list(range(len(q["right"])))
    n = len(q["left"])
    picks = list(match or [])[:n] + [None] * max(0, n - len(match or []))
    pairs, right_count = [], 0
    for i in range(n):
        p = picks[i]
        chosen = q["right"][order[p]] if isinstance(p, int) and 0 <= p < len(order) else None
        ok = chosen == q["right"][i]
        right_count += ok
        pairs.append({"left": q["left"][i], "chosen": chosen, "correct": q["right"][i], "ok": ok})
    awarded = round(mpq * right_count / n, 2) if n else 0
    fmt = lambda key: "; ".join(f"{p['left']} → {p[key] or '—'}" for p in pairs)
    answered = any(p["chosen"] for p in pairs)
    return {**base, "pairs": pairs, "correct_pairs": right_count, "total_pairs": n,
            "student_answer": fmt("chosen") if answered else None, "correct_answer": fmt("correct"),
            "correct_option": fmt("correct"), "is_correct": right_count == n, "marks_awarded": awarded}
