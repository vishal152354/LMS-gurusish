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
SOURCE_CHARS = 12000        # source text sent with each batch (split across the chosen content items)
BLANK = "____"

SYSTEM = (
    "You are an examiner writing questions for a test. Use ONLY facts stated in the source. "
    "Ask about the subject matter itself — never about the document, its headings, sections, "
    "concepts or structure, and never about email addresses, phone numbers or page details. "
    "Every question must test a DIFFERENT fact — never ask the same thing twice, even in other words. "
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


# ── repeat detection ──────────────────────────────────────────
# Two questions repeat when they test the same fact, whatever the wording or type.

_STOP = set("""a an the of to in on for and or is are was were be been by with as at from that this which what
who whom how why when where does do did it its into than then their there these those can will would should could
about between each used use using following match item items correct statement true false""".split())


def _stem(w: str) -> str:
    for suf in ("ing", "ies", "es", "ed", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)] + ("y" if suf == "ies" else "")
    return w


def _words(text: str) -> set:
    return {_stem(w) for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if w not in _STOP and len(w) > 2}


def _jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def _fingerprint(q: dict) -> dict:
    t = q.get("type", "mcq")
    if t == "match":
        pairs = [(_words(l), _words(r), _norm(l), _norm(r)) for l, r in zip(q["left"], q["right"])]
        return {"type": t, "words": _words(" ".join(q["left"] + q["right"])), "answer": "", "pairs": pairs,
                "left": {p[2] for p in pairs}}
    if t == "fill_blank":
        answer = q["answer"]
        text = q["question"].replace(BLANK, answer)
    else:
        answer = q["options"][q["correct_index"]]
        text = f'{q["question"]} {answer}'
    return {"type": t, "words": _words(text), "answer": _norm(answer), "pairs": [], "left": set()}


def _covers_pair(m: dict, o: dict) -> bool:
    """A match pair that gives away an MCQ / fill-in answer (the answer is one side of the pair,
    and the other side is what the question asks about)."""
    for lw, rw, ln, rn in m["pairs"]:
        if o["answer"] and o["answer"] in (ln, rn) and len((lw | rw) & o["words"]) >= 2:
            return True
    return False


def _strip_common(fp: dict, common: set) -> dict:
    """Drop words shared by much of the paper (e.g. the subject's name) — they say nothing about the fact."""
    if not common:
        return fp
    return {**fp, "words": fp["words"] - common,
            "pairs": [(lw - common, rw - common, ln, rn) for lw, rw, ln, rn in fp["pairs"]]}


def _common_words(fps: list) -> set:
    from collections import Counter
    df = Counter(w for fp in fps for w in fp["words"])
    cutoff = max(3, 0.25 * len(fps))
    return {w for w, n in df.items() if n >= cutoff}


def is_repeat(a: dict, b: dict) -> bool:
    if a["type"] == "match" and b["type"] == "match":
        return len(a["left"] & b["left"]) >= 2 or _jaccard(a["words"], b["words"]) >= 0.5
    if a["type"] == "match":
        return _covers_pair(a, b)
    if b["type"] == "match":
        return _covers_pair(b, a)
    sim = _jaccard(a["words"], b["words"])
    if sim >= 0.6 or (bool(a["answer"]) and a["answer"] == b["answer"] and sim >= 0.3):
        return True
    # one question's answer is stated in the other (same fact asked the other way round)
    for x, y in ((a, b), (b, a)):
        aw = _words(x["answer"])
        if aw and aw <= y["words"] and sim >= 0.4:
            return True
    return False


def _brief(q: dict) -> str:
    if q.get("type") == "match":
        return "Match: " + ", ".join(f"{l} → {r}" for l, r in zip(q["left"], q["right"]))
    if q.get("type") == "fill_blank":
        return q["question"].replace(BLANK, q["answer"])
    return f'{q["question"]} ({q["options"][q["correct_index"]]})'


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


async def generate_paper(client, graph: dict, summary: str, counts: dict, on_progress=None,
                         avoid: list | None = None, stats: dict | None = None) -> list:
    """Generate the paper. `counts` = {"mcq": n, "fill_blank": n, "match": n}.

    No two questions in the paper test the same fact. Questions from `avoid` (earlier tests
    on the same content) are steered away from and only reused if the paper would otherwise
    come up short."""
    counts = {t: max(0, int(counts.get(t, 0) or 0)) for t in TYPES}
    source = (summary or json.dumps(graph or {}))[:SOURCE_CHARS]

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

    avoid = [q for q in (avoid or []) if isinstance(q, dict) and q.get("question")]
    avoid_fps = [_fingerprint(q) for q in avoid]

    def already_asked(qs: list) -> str:
        if not qs:
            return ""
        lines = "\n".join(f"- {_brief(q)[:140]}" for q in qs[-30:])
        return f"Already asked — do NOT repeat or rephrase any of these facts:\n{lines}\n"

    async def run_batch(i, qtype, size, focus, asked=()):
        nonlocal done
        hint = f"Focus on these concepts where possible: {'; '.join(focus)}.\n" if focus else ""
        ask = size + 1                        # one spare, so a rejected question doesn't leave the paper short
        msg = (INSTRUCTIONS[qtype].format(n=ask) + "\n" + hint + already_asked(list(asked)) +
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
    results = await asyncio.gather(*[run_batch(i, t, n, groups[i] if i < len(groups) else [], avoid)
                                     for i, (t, n) in enumerate(batches)])

    # merge by type: drop any question that repeats a fact already in the paper;
    # park ones that repeat an earlier test in `reserve` (used only if the paper is short)
    report("checking")
    by_type = {t: [] for t in TYPES}
    kept, kept_fps, reserve = [], [], []
    stats_counts = {"repeat": 0, "earlier_test": 0}

    common: set = set()

    def offer(qtype, q):
        if len(by_type[qtype]) >= counts[qtype]:
            return
        fp = _strip_common(_fingerprint(q), common)
        if any(is_repeat(fp, k) for k in kept_fps):
            stats_counts["repeat"] += 1
            return
        if any(is_repeat(fp, a) for a in avoid_fps):
            stats_counts["earlier_test"] += 1
            reserve.append((qtype, q, fp))
            return
        kept.append(q); kept_fps.append(fp); by_type[qtype].append(q)

    # words common to much of this content (names, the main subject) don't distinguish facts
    common = _common_words([_fingerprint(q) for _, qs in results for q in qs] + avoid_fps)
    avoid_fps = [_strip_common(fp, common) for fp in avoid_fps]

    for qtype, qs in results:
        for q in qs:
            offer(qtype, q)

    # up to two top-up rounds for types that came back short, told what's already asked
    for round_no in range(2):
        short = {t: counts[t] - len(by_type[t]) for t in TYPES if len(by_type[t]) < counts[t]}
        if not short:
            break
        _log.info("topping up (round %d): %s", round_no + 1, short)
        total_batches += len(short)
        report("generating")
        extra = await asyncio.gather(*[run_batch(100 * (round_no + 1) + j, t, n, [], kept + avoid)
                                       for j, (t, n) in enumerate(short.items())])
        report("checking")
        for qtype, qs in extra:
            for q in qs:
                offer(qtype, q)

    # still short: fall back to questions that overlap an earlier test (never one already in this paper)
    reused = 0
    for qtype, q, fp in reserve:
        if len(by_type[qtype]) < counts[qtype] and not any(is_repeat(fp, k) for k in kept_fps):
            kept.append(q); kept_fps.append(fp); by_type[qtype].append(q)
            reused += 1
    if stats is not None:
        stats.update(repeats_dropped=stats_counts["repeat"], reused_from_earlier=reused)

    paper = [q for t in TYPES for q in by_type[t][:counts[t]]]
    _log.info("paper: %s (dropped %d repeats, %d overlapping earlier tests)",
              {t: len(by_type[t][:counts[t]]) for t in TYPES}, stats_counts["repeat"], stats_counts["earlier_test"])
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


def q_marks(q: dict, default: float = 1) -> float:
    """Marks this question is worth (set per type by the teacher; older papers use one value)."""
    return q.get("marks") or default


def paper_total(questions: list, default: float = 1) -> float:
    total = round(sum(q_marks(q, default) for q in questions), 2)
    return int(total) if total == int(total) else total


def mark(q: dict, *, text: str | None, match: list | None, right_order: list | None,
         mpq: float, letters: list, parse_selection) -> dict:
    """Mark one answer. Returns the question-log fields for it."""
    t = qtype(q)
    mpq = q_marks(q, mpq)
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
