import os, re, json, asyncio, random, logging
from datetime import datetime
from pathlib import Path
import urllib.request, urllib.error

logging.basicConfig(
    filename="/tmp/hermes_viva.log",
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s %(message)s",
)
_log = logging.getLogger("hermes_client")

HERMES_BIN = os.getenv("HERMES_BIN", os.path.expanduser("~/.local/bin/hermes"))

# Hermes API Server (persistent — no subprocess overhead)
HERMES_API_URL = os.getenv("HERMES_API_URL",  "http://localhost:8642/v1")
HERMES_API_KEY = os.getenv("HERMES_API_KEY",  "")
# Model name sent to the API — override to call a local server (e.g. Ollama "hermes3:8b") directly
HERMES_MODEL   = os.getenv("HERMES_MODEL",    "hermes-agent")
# Optional minimum request timeout (seconds) — local models can be slow on cold start
HERMES_API_TIMEOUT = int(os.getenv("HERMES_API_TIMEOUT", "0"))

# Ollama Cloud (fallback only)
OLLAMA_BASE  = os.getenv("OLLAMA_BASE_URL",  "https://ollama.com/v1")
OLLAMA_KEY   = os.getenv("OLLAMA_API_KEY",   "")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL",     "gemma3:27b")

_GREETINGS = ("good morning", "good afternoon", "good evening", "good day")

_DONT_KNOW_PHRASES = (
    "i don't know", "i dont know", "i do not know",
    "i can't remember", "i cant remember", "i cannot remember",
    "i'm not able to remember", "i am not able to remember",
    "i have no idea", "no idea at all", "i have no idea at all",
    "no idea",                              # standalone — must be listed explicitly
    "i'm not sure", "i am not sure", "not sure",
    "i forgot", "i have forgotten",
    "i don't remember", "i dont remember",
    "i have no clue", "no clue", "idk",
    "don't know", "dont know",
    "i cannot answer", "i can't answer", "i am unable to answer",
)

def _is_dont_know(answer: str) -> bool:
    """Return True when the student's answer is a don't-know admission."""
    lower = answer.lower().strip()
    if lower in _DONT_KNOW_PHRASES:
        return True
    # Short answers (≤ 12 words) that contain a known phrase
    if len(lower.split()) <= 12:
        for phrase in _DONT_KNOW_PHRASES:
            if phrase in lower:
                return True
    return False


_CONTENT_STOP = frozenset([
    "the","a","an","and","or","but","in","on","at","to","for","of","with","by","from",
    "is","are","was","were","be","been","have","has","had","do","does","did","will",
    "would","could","should","may","might","can","this","that","these","those","it","its",
    "how","what","why","when","where","which","who","your","their","our","my","his","her",
    "just","also","even","such","than","very","quite","more","most","some","any",
    "think","believe","know","feel","seem","said","says","went","came","made","work",
    "said","used","here","there","then","them","they","well","been","into","over","also",
])

def _content_words(text: str) -> set:
    """Extract 4+-char non-stop-word tokens from text."""
    return {w for w in re.findall(r'\b[a-z]{4,}\b', text.lower()) if w not in _CONTENT_STOP}

def _is_off_domain(answer: str, question: str, graph_summary: str) -> bool:
    """
    Return True when a substantial answer shares zero content words with the question
    and knowledge graph — indicating a completely off-topic domain.
    Only triggers for answers with ≥10 content words to avoid false positives on short attempts.
    """
    answer_words = _content_words(answer)
    if len(answer_words) < 6:
        return False  # very short — handled by don't-know detection or scored leniently
    topic_words = _content_words(question) | _content_words(graph_summary[:800])
    # ≤1 overlap: one generic shared word (e.g. "system") is not enough to indicate domain relevance
    return len(answer_words & topic_words) <= 1


def _fix_greeting(text: str, correct: str) -> str:
    """Replace any wrong time-of-day greeting with the correct one."""
    lower = text.lower()
    for g in _GREETINGS:
        if g in lower and g != correct.lower():
            idx = lower.index(g)
            return text[:idx] + correct + text[idx + len(g):]
    return text


class HermesClient:

    # ──────────────────────────────────────────────────────────────
    # CORE — Hermes API Server call (persistent process, no subprocess overhead)
    # ──────────────────────────────────────────────────────────────

    @staticmethod
    def _load_skill_md() -> str:
        """Load viva-agent SKILL.md body (strip YAML frontmatter) for use as system prompt."""
        skill_path = Path(os.getenv("SKILL_PATH", os.path.expanduser("~/.hermes/skills/viva-agent/SKILL.md")))
        try:
            text = skill_path.read_text()
            # Strip YAML frontmatter (--- ... ---)
            if text.startswith("---"):
                end = text.find("\n---", 3)
                if end != -1:
                    text = text[end + 4:].lstrip()
            return text
        except Exception:
            return "You are an AI viva voce examiner. Ask 10 medium-to-difficult questions. Evaluate each answer and return JSON scores."

    async def _hermes_api(self, message: str, session_id: str | None = None,
                          timeout: int = 60,
                          conversation_history: list | None = None,
                          system: str | None = None,
                          max_tokens: int = 1200) -> tuple[str, str | None]:
        """
        Call the Hermes API server (running at localhost:8642).
        Sends full conversation history as messages array so the model has context.
        `system` replaces the viva-agent skill prompt (used by non-viva tasks such as prep generation).
        Returns (response_text, session_id).
        """
        skill_system = system or self._load_skill_md()

        messages = [{"role": "system", "content": skill_system}]

        # Inject full conversation history so the model knows which question it's on
        if conversation_history:
            for turn in conversation_history:
                role = "user" if turn["role"] == "student" else "assistant"
                content = turn.get("content", "")
                if content:
                    messages.append({"role": role, "content": content})

        # Current user message
        messages.append({"role": "user", "content": message})

        payload = json.dumps({
            "model": HERMES_MODEL,
            "messages": messages,
            "max_tokens": max_tokens,
        }).encode()

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {HERMES_API_KEY}",
        }
        if session_id:
            headers["X-Hermes-Session-Id"] = session_id

        req = urllib.request.Request(
            f"{HERMES_API_URL}/chat/completions",
            data=payload,
            headers=headers,
            method="POST",
        )

        timeout = max(timeout, HERMES_API_TIMEOUT)
        loop = asyncio.get_event_loop()
        def _do():
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())

        try:
            result = await loop.run_in_executor(None, _do)
        except Exception as e:
            raise RuntimeError(f"Hermes API server error: {e}")

        content = result["choices"][0]["message"]["content"]
        # Extract session_id from response headers if available
        sid = result.get("id") or session_id  # Hermes returns session id in 'id' field
        _log.info("Hermes API response (sid=%s, first 200): %s", sid, content[:200])
        return content, sid

    # ──────────────────────────────────────────────────────────────
    # FALLBACK — subprocess call to hermes agent (kept for OKF pipeline)
    # ──────────────────────────────────────────────────────────────

    async def _call(self, message: str, session_id: str | None = None,
                    timeout: int = 180) -> tuple[str, str | None]:
        """
        Call Hermes agent via subprocess.
        New session: session_id=None loads viva-agent skill.
        Resume: session_id=<id> continues the conversation.
        Returns (response_text, session_id).
        """
        cmd = [HERMES_BIN, "chat", "-Q", "--pass-session-id"]
        if session_id:
            cmd += ["--resume", session_id]
        else:
            cmd += ["-s", "viva-agent"]
        cmd += ["-q", message]

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            raise RuntimeError(f"Hermes timed out after {timeout}s")
        except Exception as e:
            raise RuntimeError(f"Hermes subprocess failed: {e}")

        # session_id is written to stderr by --pass-session-id
        err = stderr.decode("utf-8", errors="replace")
        sid = session_id
        for line in err.splitlines():
            if line.startswith("session_id:"):
                sid = line.split(":", 1)[1].strip()
                break

        # response text is in stdout; strip any ↻ resume header lines
        output = stdout.decode("utf-8", errors="replace")
        _log.debug("HERMES RAW STDOUT (sid=%s):\n%s", sid, output[:2000])
        response_lines = []
        for line in output.splitlines():
            if line.startswith("↻"):
                continue
            response_lines.append(line)

        return "\n".join(response_lines).strip(), sid

    @staticmethod
    def _tolerant_obj_parse(raw: str) -> dict:
        """Parse a flat JSON-ish object even when the model emits invalid JSON.

        Handles two failure modes common to hosted models (e.g. Gemini):
        unescaped double-quotes inside string values, and raw newlines/tabs
        inside strings. Does NOT rely on quote balancing: each top-level key's
        value is the text spanning from that key up to the next top-level key.
        """
        data: dict = {}
        # Top-level keys are anchored by a preceding '{' or ',' so that
        # quote-like or colon-like text inside a value is not mistaken for a key.
        anchors = [(m.group(1), m.end(), m.start())
                   for m in re.finditer(r'[{,]\s*"(\w+)"\s*:', raw)]
        if not anchors:
            return data
        last_close = raw.rfind("}")
        for idx, (key, vstart, _kstart) in enumerate(anchors):
            vend = anchors[idx + 1][2] if idx + 1 < len(anchors) else \
                (last_close if last_close > vstart else len(raw))
            val = raw[vstart:vend].strip().rstrip(",").strip()
            data[key] = HermesClient._coerce_value(val)
        return data

    @staticmethod
    def _coerce_value(val: str):
        if not val:
            return ""
        if val[0] == '"':
            end = val.rfind('"')
            inner = val[1:end] if end > 0 else val[1:]
            return (inner.replace('\\"', '"')
                         .replace('\\n', '\n')
                         .replace('\\t', '\t')
                         .strip())
        low = val.lower()
        if low == "true":
            return True
        if low == "false":
            return False
        if low in ("null", "none"):
            return None
        try:
            return int(val)
        except ValueError:
            pass
        try:
            return float(val)
        except ValueError:
            return val.strip().strip('"')

    @staticmethod
    def _parse_or_repair(raw: str) -> dict | None:
        """json.loads with control chars allowed; fall back to tolerant parse."""
        try:
            return json.loads(raw, strict=False)
        except Exception:
            repaired = HermesClient._tolerant_obj_parse(raw)
            return repaired or None

    @staticmethod
    def _extract_json_block(text: str) -> tuple[str, dict]:
        """Find and remove a JSON block from the response.

        Returns (text_without_json, data_dict).
        Works regardless of whether the JSON is at the start, middle, or end,
        and tolerates malformed JSON produced by hosted models.
        """
        # Strategy 1: fenced code block ```json ... ``` (balanced braces, so
        # nested objects are not truncated; closing fence optional).
        fence = re.search(r'```(?:json)?\s*', text)
        if fence:
            brace = text.find("{", fence.end())
            if brace >= 0:
                span_end = HermesClient._balanced_end(text, brace)
                if span_end > brace:
                    raw = text[brace:span_end]
                    data = HermesClient._parse_or_repair(raw)
                    if data:
                        # Remove from the fence start to the closing fence (if any)
                        after = text.find("```", span_end)
                        cut_end = after + 3 if after >= 0 else span_end
                        clean = (text[:fence.start()] + text[cut_end:]).strip()
                        clean = clean.strip("`").strip()
                        return clean, data

        # Strategy 2: last balanced {...} block in the text
        last_close = text.rfind("}")
        if last_close >= 0:
            depth = 0
            for i in range(last_close, -1, -1):
                if text[i] == "}":
                    depth += 1
                elif text[i] == "{":
                    depth -= 1
                    if depth == 0:
                        raw = text[i:last_close + 1]
                        data = HermesClient._parse_or_repair(raw)
                        if data:
                            clean = (text[:i] + text[last_close + 1:]).strip()
                            return clean, data
                        break

        _log.warning("No JSON found in response (first 400 chars): %s", text[:400])
        return text, {}

    @staticmethod
    def _balanced_end(text: str, open_idx: int) -> int:
        """Return index just past the '}' matching the '{' at open_idx, or -1.

        Quote-aware so braces inside string values don't throw off the count;
        tolerant of unescaped inner quotes by only toggling on quotes that look
        like real string delimiters (preceded by : , { [ or whitespace/newline).
        """
        depth = 0
        in_str = False
        i = open_idx
        n = len(text)
        while i < n:
            c = text[i]
            if in_str:
                if c == "\\":
                    i += 2
                    continue
                if c == '"':
                    in_str = False
            else:
                if c == '"':
                    in_str = True
                elif c == "{" or c == "[":
                    depth += 1
                elif c == "}" or c == "]":
                    depth -= 1
                    if depth == 0:
                        return i + 1
            i += 1
        return -1

    # ──────────────────────────────────────────────────────────────
    # OKF BUNDLE PRODUCTION
    # ──────────────────────────────────────────────────────────────

    async def produce_okf_bundle(self, source_path: str, bundle_dir: str,
                                  filename: str, timeout: int = 600) -> bool:
        """
        Call Hermes with the OKF skill to produce a knowledge bundle.
        Hermes reads the source file and writes OKF concept files into bundle_dir.
        Returns True when bundle files are present after the call.
        """
        # Clean up existing md files in bundle_dir to avoid false success from previous runs
        from pathlib import Path as _P
        bundle_path = _P(bundle_dir)
        if bundle_path.exists():
            for f in bundle_path.glob("*.md"):
                try:
                    f.unlink()
                except Exception:
                    pass

        msg = (
            f"[PRODUCE] Produce an OKF knowledge bundle for viva examination.\n"
            f"Source file: {source_path}\n"
            f"Output directory: {bundle_dir}\n"
            f"Document name: {filename}\n\n"
            f"Read the source file completely (use multiple file_read calls if needed). "
            f"Extract 8-15 key concepts, methods, findings, and conclusions that cover "
            f"the ENTIRE document. Write detailed OKF files — the content will be used "
            f"to ask 10 medium-to-difficult viva examination questions. "
            f"Output BUNDLE_COMPLETE when all files are written."
        )

        cmd = [HERMES_BIN, "chat", "-Q", "-s", "okf", "-q", msg]
        _log.info("Starting OKF bundle production for: %s", filename)

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            _log.error("OKF produce timed out after %ds for %s", timeout, filename)
            return False
        except Exception as e:
            _log.error("OKF produce subprocess error: %s", e)
            return False

        output = stdout.decode("utf-8", errors="replace")
        _log.info("OKF produce completed. Output (first 600 chars): %s", output[:600])

        # Success if BUNDLE_COMPLETE seen OR at least 3 .md files exist
        from pathlib import Path as _P
        md_files = list(_P(bundle_dir).glob("*.md"))
        success = "BUNDLE_COMPLETE" in output or len(md_files) >= 3
        _log.info("OKF bundle files found: %d — success=%s", len(md_files), success)
        return success

    # ──────────────────────────────────────────────────────────────
    # MCQ QUIZ — generate all questions up-front (one model call)
    # ──────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_mcq_array(text: str) -> list:
        """Extract a JSON array of MCQ objects, tolerating fences / minor noise."""
        t = re.sub(r'```(?:json)?', '', text)
        start = t.find('[')
        end = t.rfind(']')
        if start >= 0 and end > start:
            raw = t[start:end + 1]
            try:
                data = json.loads(raw, strict=False)
                if isinstance(data, list):
                    return data
            except Exception as e:
                _log.warning("MCQ array parse failed, trying per-object: %s", e)
            objs = []
            for m in re.finditer(r'\{[\s\S]*?\}', raw):
                try:
                    objs.append(json.loads(m.group(0), strict=False))
                except Exception:
                    obj = HermesClient._tolerant_obj_parse(m.group(0))
                    if obj:
                        objs.append(obj)
            return objs
        return []

    async def generate_mcq_quiz(self, graph: dict, graph_summary: str,
                                 student_name: str, num_questions: int = 10,
                                 on_progress=None) -> list:
        """Generate `num_questions` MCQs from the knowledge source in a single call.

        Returns a list of {"question": str, "options": [4 strings], "correct_index": 0-3}.
        Scoring is done server-side against correct_index, so the model is never
        trusted to grade — only to author questions.
        """
        knowledge = graph_summary[:16000] if graph_summary else json.dumps(graph)[:16000]
        system = (
            "You are an examiner who writes multiple-choice questions. "
            "You reply with ONLY a JSON array — no prose, no explanation, no markdown fences."
        )
        msg = (
            f"Using ONLY the KNOWLEDGE SOURCE below, create exactly {num_questions} "
            f"multiple-choice questions of medium-to-hard difficulty that test genuine "
            f"understanding of the material (not trivial recall).\n"
            f"Rules:\n"
            f"- Each question has exactly 4 options and exactly ONE correct option.\n"
            f"- Every question and its correct answer MUST be supported by the knowledge source.\n"
            f"- Make the 3 wrong options plausible but clearly incorrect per the source.\n"
            f"- Vary the position of the correct option across the {num_questions} questions.\n"
            f"- Keep each option concise (a short phrase or single sentence).\n"
            f"- Add a one-sentence 'explanation' saying why the correct option is right.\n\n"
            f"Return ONLY a JSON array of {num_questions} objects, each exactly:\n"
            f'{{"question": "...", "options": ["A","B","C","D"], "correct_index": 0, "explanation": "..."}}\n\n'
            f"KNOWLEDGE SOURCE:\n{knowledge}"
        )
        # Free/hosted models are occasionally flaky (empty body, rate limit) or
        # drift from the schema — retry a couple of times before giving up.
        def _report(stage: str, attempt: int = 0):
            if on_progress:
                try:
                    on_progress(stage, attempt)
                except Exception:
                    pass

        raw_items: list = []
        for attempt in range(3):
            _report("generating", attempt + 1)
            try:
                response, _ = await self._hermes_api(
                    msg, session_id=None, timeout=70, system=system, max_tokens=4000
                )
            except Exception as e:
                _log.warning("MCQ generation attempt %d failed: %s", attempt + 1, e)
                continue
            raw_items = self._parse_mcq_array(response)
            if len(raw_items) >= max(1, num_questions // 2):
                break
            _log.warning("MCQ generation attempt %d parsed only %d items; retrying",
                         attempt + 1, len(raw_items))

        _report("checking")
        clean: list = []
        for q in raw_items:
            question = q.get("question") or q.get("stem")
            opts = q.get("options") or q.get("choices")
            if not (isinstance(question, str) and question.strip()
                    and isinstance(opts, list) and len(opts) >= 2):
                continue
            opts = [str(o).strip() for o in opts[:4] if str(o).strip()]
            while len(opts) < 4:
                opts.append("None of the above")
            ci = self._resolve_correct_index(q, opts)
            expl = q.get("explanation") or q.get("rationale") or q.get("reason") or ""
            clean.append({
                "question": question.strip(),
                "options": opts,
                "correct_index": ci,
                "explanation": str(expl).strip(),
            })
            if len(clean) >= num_questions:
                break
        _log.info("Generated %d MCQs (requested %d)", len(clean), num_questions)
        return clean

    @staticmethod
    def _resolve_correct_index(q: dict, opts: list) -> int:
        """Figure out the correct option index from any of the shapes models emit:
        correct_index / answer_index (int), or answer / correct_answer /
        correct_option (letter 'A'-'D' or the option text)."""
        letters = ["A", "B", "C", "D"]
        # Direct integer index fields
        for k in ("correct_index", "answer_index", "correct", "correctIndex"):
            v = q.get(k)
            if isinstance(v, bool):
                continue
            try:
                return max(0, min(len(opts) - 1, int(v)))
            except (TypeError, ValueError):
                pass
        # Letter or text answer fields
        for k in ("answer", "correct_answer", "correct_option", "correctAnswer"):
            v = q.get(k)
            if not isinstance(v, str) or not v.strip():
                continue
            s = v.strip()
            # single letter like "A" or "B)"
            m = re.match(r"^\(?([A-D])[).\s]*$", s, re.IGNORECASE)
            if m:
                return letters.index(m.group(1).upper())
            # full option text — match (case-insensitive, trimmed)
            for i, o in enumerate(opts):
                if o.strip().lower() == s.lower():
                    return i
            # option text that starts with the answer (partial)
            for i, o in enumerate(opts):
                if o.strip().lower().startswith(s.lower()) or s.lower().startswith(o.strip().lower()):
                    return i
        return 0

    # ──────────────────────────────────────────────────────────────
    # VIVA VOCE — START SESSION (10 questions, medium-to-difficult)
    # ──────────────────────────────────────────────────────────────


    async def start_viva_session(self, graph: dict, graph_summary: str,
                                  student_name: str, bundle_path: str) -> dict:
        hour = datetime.now().hour
        if hour < 12:
            time_greeting = "Good morning"
        elif hour < 17:
            time_greeting = "Good afternoon"
        else:
            time_greeting = "Good evening"

        graph_text = graph_summary[:20000] if graph_summary else json.dumps(graph, indent=2)[:20000]

        # Extract topic dynamically from graph
        topic = graph.get("title", "") if isinstance(graph, dict) else ""
        if not topic and isinstance(graph, dict) and graph.get("nodes"):
            topic = graph["nodes"][0].get("title", "")
        if not topic:
            topic = "their uploaded research report"

        msg = (
            f"You are examining {student_name} on their research report about {topic}.\n\n"
            f"KNOWLEDGE SOURCE — USE ONLY THIS CONTENT:\n"
            f"{graph_text}\n\n"
            f"Generate your questions from the above content only. Do not use any external knowledge.\n\n"
            f"[WEB-API-MODE] Session start.\n"
            f"Student: {student_name}\n"
            f"Time greeting: {time_greeting}\n\n"
            f"Select exactly 10 medium-to-difficult questions covering different concepts above. "
            f"Greet the student warmly and ask Question 1 now. "
            f"Append the session-start JSON block."
        )

        try:
            response, sid = await self._hermes_api(msg, session_id=None, timeout=60)
            _log.info("Hermes API start_viva (sid=%s, first 300): %s", sid, response[:300])
        except Exception as e:
            _log.error("Hermes API failed for start_viva, falling back to subprocess: %s", e)
            response, sid = await self._call(msg, session_id=None, timeout=120)

        clean, data = self._extract_json_block(response)
        data["hermes_session_id"] = sid
        data["start_message"] = msg  # stored in history so model sees WEB-API-MODE trigger

        opening = data.get("opening_line", f"{time_greeting}, {student_name}. I am your viva examiner today.")
        data["opening_line"] = _fix_greeting(opening, time_greeting)

        first_q = data.get("first_question") or data.get("scenario", "Please explain the core concept from your uploaded material.")
        if not first_q.rstrip().endswith("?"):
            first_q = first_q.rstrip() + "?"
        data["scenario"] = first_q
        data["first_question"] = first_q

        data.setdefault("question_number", 1)
        data.setdefault("total_questions", 10)
        data.setdefault("topic", "Question 1")
        return data

    async def handle_viva_answer(self, student_answer: str,
                                  question_number: int,
                                  hermes_session_id: str | None = None,
                                  is_hint: bool = False,
                                  graph_summary: str = "",
                                  conversation_history: list | None = None,
                                  visited_nodes: list | None = None,
                                  previous_question: str = "",
                                  student_name: str = "Student",
                                  graph: dict = None) -> dict:
        is_last = (question_number >= 10)
        next_q_num = question_number + 1

        # Build visited / previous-question context so the model never repeats (Bug 1 fix)
        visited_str = ", ".join(visited_nodes) if visited_nodes else "none yet"
        prev_q_str  = previous_question.strip()[:250] if previous_question else "(not recorded)"

        # Extract topic dynamically from graph
        topic = graph.get("title", "") if isinstance(graph, dict) else ""
        if not topic and isinstance(graph, dict) and graph.get("nodes"):
            topic = graph["nodes"][0].get("title", "")
        if not topic:
            topic = "their uploaded research report"

        system_block = (
            f"You are examining {student_name} on their research report about {topic}.\n\n"
            f"KNOWLEDGE SOURCE — USE ONLY THIS CONTENT:\n"
            f"---\n{graph_summary[:20000]}\n---\n\n"
            f"Generate your next question from the above content only. Do not use any external knowledge.\n"
        )

        dont_know = False   # set inside else branch; used after the try/except

        if is_hint:
            msg = (
                f"{system_block}\n"
                f"[WEB-API] [HINT REQUEST]\n"
                f"Examination in progress — Q{question_number} of 10. Student: {student_name}.\n"
                f"Question asked: {prev_q_str}\n"
                f"Student answer so far: {student_answer}\n"
                f"Give ONE small hint without revealing the full answer.\n"
                f'Append JSON: {{"new_phase":"{prev_q_str[:40]}","should_close":false,'
                f'"knowledge":0,"understanding":0,"application":0,'
                f'"question_number":{question_number},"next_question":""}}'
            )
        else:
            next_q_instr = (
                'set next_question to "" and should_close to true, then give the closing debrief.'
                if is_last else
                f'set next_question to the full text of Q{next_q_num} (from the knowledge source, ending with ?).'
            )

            # Detect answer type — determines scoring instructions and Python-side overrides
            dont_know  = _is_dont_know(student_answer)
            off_domain = (not dont_know and
                          _is_off_domain(student_answer, prev_q_str, graph_summary))

            if dont_know:
                msg = (
                    f"{system_block}\n"
                    f"[WEB-API] Q{question_number} of 10 just answered. Student: {student_name}.\n"
                    f"Question asked: \"{prev_q_str}\"\n"
                    f"Student answer: \"{student_answer}\"\n"
                    f"ANSWER TYPE: DON'T KNOW — student admitted they do not know.\n"
                    f"ALL THREE scores MUST be 0 — do not change them.\n"
                    f"Topics covered so far (DO NOT repeat): {visited_str}\n"
                    f"MANDATORY FIRST OUTPUT — output this JSON exactly (keep all scores as 0), "
                    f"then ONE brief encouraging sentence:\n"
                    f"```json\n"
                    f'{{"new_phase":"<name of the topic Q{question_number} covered>","should_close":{str(is_last).lower()},'
                    f'"knowledge":0,"understanding":0,"application":0,'
                    f'"question_number":{question_number},'
                    f'"next_question":"<{next_q_instr}>"}}\n'
                    f"```\n"
                    f"After the JSON, write ONE brief encouraging sentence, "
                    f"then {next_q_instr if is_last else 'ask Q' + str(next_q_num) + ' immediately.'}."
                )
            else:
                msg = (
                    f"{system_block}\n"
                    f"[WEB-API] Q{question_number} of 10 just answered. Student: {student_name}.\n"
                    f"Question asked: \"{prev_q_str}\"\n"
                    f"Student answer: \"{student_answer}\"\n"
                    f"Topics covered so far (DO NOT repeat): {visited_str}\n"
                    f"SCORING PROCEDURE — follow in order:\n"
                    f"  STEP 1 — RELEVANCE: Does the answer address the question's actual subject?\n"
                    f"    If the answer is about a completely different topic (wrong domain entirely):\n"
                    f"    FORCE knowledge=0, understanding=0, application=0.\n"
                    f"    Only proceed if the answer attempts the actual question topic.\n"
                    f"  STEP 2 — KNOWLEDGE (compare against the knowledge source above):\n"
                    f"    Does the student know the factual content of their own research? (coefficients, sample sizes, etc.)\n"
                    f"    Wrong or contradicts: 0-2 | Partial: 4-6 | Precise: 7-10\n"
                    f"  STEP 3 — UNDERSTANDING:\n"
                    f"    Does the student understand why they did what they did? (interpret results, explain reasoning)\n"
                    f"    Surface level: 2-4 | Good: 5-7 | Clear interpretation: 8-10\n"
                    f"  STEP 4 — APPLICATION:\n"
                    f"    Can they apply research knowledge to new situations? (justify recommendations, extend findings)\n"
                    f"    Stays in report: 2-4 | Some connection: 5-7 | Thinks beyond report: 8-10\n"
                    f"MANDATORY FIRST OUTPUT — start your reply with this JSON block (fill in every field, "
                    f"then write 1-2 sentences of feedback after it):\n"
                    f"```json\n"
                    f'{{"new_phase":"<name of the topic Q{question_number} covered>","should_close":{str(is_last).lower()},'
                    f'"knowledge":<integer 0-10 for knowledge/facts>,'
                    f'"understanding":<integer 0-10 for understanding/reasoning>,'
                    f'"application":<integer 0-10 for application/extension>,'
                    f'"question_number":{question_number},'
                    f'"next_question":"<{next_q_instr}>"}}\n'
                    f"```\n"
                    f"After the JSON, {next_q_instr if is_last else 'write 1-2 sentences of honest feedback on the answer above, then stop.'}"
                )

        try:
            # Self-contained message — no history needed; everything is in the message body
            response, sid = await self._hermes_api(msg, session_id=hermes_session_id, timeout=60)
            _log.info("Hermes API answer Q%d (sid=%s, first 200): %s", question_number, sid, response[:200])
        except Exception as e:
            _log.error("Hermes API failed for answer Q%d, falling back to subprocess: %s", question_number, e)
            response, sid = await self._call(msg, session_id=hermes_session_id, timeout=120)

        clean, data = self._extract_json_block(response)

        # CRITICAL: evaluate json_found BEFORE adding any defaults.
        # After the setdefaults below, data is never empty, so bool(data) would
        # always be True even when the model returned no JSON at all.
        json_found = bool(data)
        if not json_found:
            _log.warning("Q%d: No JSON block in model response — using neutral score fallback", question_number)

        data["hermes_session_id"] = sid
        data.setdefault("response", clean or "Thank you. Let us move on.")
        data.setdefault("new_phase", data.get("topic", f"Question {question_number}"))
        data.setdefault("should_close", False)
        # milestone flags based on question count
        data.setdefault("has_framework",      question_number >= 3)
        data.setdefault("has_calculation",    question_number >= 7)
        data.setdefault("has_recommendation", False)

        def _score(primary, *aliases):
            for k in (primary,) + aliases:
                v = data.get(k)
                if v is not None:
                    try:
                        return max(0, min(10, int(v)))
                    except (TypeError, ValueError):
                        pass
            # Key absent: neutral fallback (not 0, which implies "wrong answer")
            return 5 if not json_found else 0

        data["knowledge"]     = _score("knowledge",     "structured_thinking",  "content_accuracy")
        data["understanding"] = _score("understanding", "quantitative_ability", "reasoning_depth")
        data["application"]   = _score("application",   "hypothesis_driven",    "confidence")

        # Compatibility mappings so the route layer doesn't break if it reads old keys:
        data["structured_thinking"]  = data["knowledge"]
        data["quantitative_ability"] = data["understanding"]
        data["hypothesis_driven"]    = data["application"]
        data["communication"]        = data["understanding"]

        # Belt-and-suspenders overrides — enforce correct zeros regardless of model output
        if dont_know:
            data["knowledge"]     = 0
            data["understanding"] = 0
            data["application"]   = 0
            data["structured_thinking"]  = 0
            data["quantitative_ability"] = 0
            data["communication"]        = 0
            data["hypothesis_driven"]    = 0
            if not data.get("response"):
                data["response"] = "That is alright — let us keep going."
        elif off_domain:
            data["knowledge"]     = 0
            data["understanding"] = 0
            data["application"]   = 0
            data["structured_thinking"]  = 0
            data["quantitative_ability"] = 0
            data["hypothesis_driven"]    = 0

        _log.debug(
            "Q%d scores: kn=%d un=%d ap=%d | json_keys=%s",
            question_number,
            data["knowledge"], data["understanding"], data["application"],
            list(data.keys()),
        )

        data.setdefault("question_number", question_number)
        # Accept "scenario" as fallback for "next_question" (old model format)
        if not data.get("next_question") and data.get("scenario"):
            data["next_question"] = data["scenario"]
        data.setdefault("next_question", "")
        return data

    async def generate_viva_evaluation(self, student_name: str,
                                        session_minutes: int,
                                        exchange_scores: list,
                                        hermes_session_id: str | None = None,
                                        questions_answered: int = 10,
                                        question_log: list | None = None) -> dict:
        total_questions = 10

        def avg(key: str) -> float:
            vals = [s.get(key) for s in exchange_scores if s.get(key) is not None]
            if not vals:
                alt_keys = {
                    "knowledge": ["structured_thinking", "content_accuracy"],
                    "understanding": ["quantitative_ability", "reasoning_depth"],
                    "application": ["hypothesis_driven", "confidence"],
                }.get(key, [])
                for ak in alt_keys:
                    vals = [s.get(ak) for s in exchange_scores if s.get(ak) is not None]
                    if vals:
                        break
            if not vals:
                return 0.0
            return sum(vals) / len(vals)

        # Raw averages from per-answer scores (0-10 each)
        raw_st = avg("knowledge")
        raw_hd = avg("understanding")
        raw_qa = avg("application")

        completion_ratio = min(1.0, questions_answered / total_questions)

        def penalised(raw: float) -> int:
            return max(0, min(10, round(raw * completion_ratio)))

        st = penalised(raw_st)
        hd = penalised(raw_hd)
        qa = penalised(raw_qa)

        # Compute strong/weak topic areas directly from per-question log data.
        computed_strong: list = []
        computed_weak:   list = []
        topic_lines:     list = []
        if question_log:
            for entry in question_log:
                topic = entry.get("node", "").strip()
                if not topic or topic.lower().startswith("question "):
                    continue
                kn   = entry.get("knowledge", entry.get("structured_thinking", 5))
                und  = entry.get("understanding", entry.get("quantitative_ability", 5))
                avg_s = (kn + und) / 2
                topic_lines.append(f"  {topic}: knowledge={kn}/10, understanding={und}/10")
                if avg_s >= 7 and topic not in computed_strong:
                    computed_strong.append(topic)
                elif avg_s < 5 and topic not in computed_weak:
                    computed_weak.append(topic)

        incomplete_note = ""
        if questions_answered < total_questions:
            incomplete_note = (
                f"IMPORTANT: The student only answered {questions_answered} out of "
                f"{total_questions} questions and did NOT complete the examination. "
                f"The scores have been penalised for incompleteness. "
                f"Reflect this clearly in your overall_comment and areas_to_improve."
            )

        _log.info(
            "Evaluation: answered=%d/%d completion=%.0f%% raw=[%.1f,%.1f,%.1f] "
            "penalised=[%d,%d,%d]",
            questions_answered, total_questions, completion_ratio * 100,
            raw_st, raw_hd, raw_qa, st, hd, qa,
        )

        topic_summary = (
            "Per-topic scores:\n" + "\n".join(topic_lines) + "\n"
        ) if topic_lines else ""

        strong_hint = ", ".join(computed_strong) if computed_strong else "none identified"
        weak_hint   = ", ".join(computed_weak)   if computed_weak   else "none identified"

        msg = (
            f"[FINAL-DEBRIEF] The viva examination has ended. "
            f"Student: {student_name}. Session: {session_minutes} minutes. "
            f"Questions answered: {questions_answered} out of {total_questions}.\n"
            f"{incomplete_note}\n"
            f"{topic_summary}"
            f"Pre-computed penalised scores (use EXACTLY these values in the JSON — do NOT change them) — "
            f"knowledge:{st}, understanding:{hd}, application:{qa}.\n"
            f"Strong topics (scored ≥7 on content+reasoning): {strong_hint}\n"
            f"Weak topics (scored <5 on content+reasoning): {weak_hint}\n\n"
            f"Provide a precise, correct, and concise overall comment (not lengthy, max 2-3 sentences) summarizing how the student performed, "
            f"then append the final-debrief JSON block."
        )

        response, _ = await self._call(msg, session_id=hermes_session_id, timeout=180)
        clean, data = self._extract_json_block(response)

        _log.info("Final-debrief JSON extracted: %s", data)

        model_strong = [s for s in data.get("strong_areas", [])
                        if s and s.strip().lower() not in ("none noted", "none", "")]
        model_weak   = [a for a in data.get("areas_to_improve", [])
                        if a and a.strip().lower() not in ("none noted", "none", "")]

        # Construct clean, precise and correct closing text
        comment = data.get("overall_comment", "")
        strong_list = model_strong or computed_strong
        weak_list = model_weak or computed_weak
        
        strong_str = "\n".join([f"• {s}" for s in strong_list]) if strong_list else "• None noted"
        weak_str = "\n".join([f"• {w}" for w in weak_list]) if weak_list else "• None noted"
        
        clean_closing = (
            f"Overall Feedback:\n{comment}\n\n"
            f"Strong Areas (Areas to Focus):\n{strong_str}\n\n"
            f"Areas to Review:\n{weak_str}"
        )

        return {
            "knowledge":        st,
            "understanding":    hd,
            "confidence":       0,
            "application":      qa,
            "contribution":     0,
            "strong_areas":     model_strong or computed_strong,
            "areas_to_improve": model_weak   or computed_weak,
            "overall_comment":  comment,
            "closing_text":     clean_closing,
        }

    async def chat(self, prompt: str, max_tokens: int = 2000,
                   system: str = "", temperature: float = 0.9) -> str:
        """One-shot chat used by V1 methods. Routes through Hermes (no skill)."""
        full = (f"{system}\n\n{prompt}" if system else prompt)
        response, _ = await self._call(full, session_id=None, timeout=300)
        clean, _ = self._extract_json_block(response)
        return clean or response

    async def viva_question(self, node_content, question_number, level, student_name, history):
        level_instructions = {
            "factual":       "Ask a direct factual question about what the student wrote. Reference their own content specifically.",
            "understanding": "Ask a conceptual or reasoning question. Ask them to explain WHY or HOW.",
            "application":   "Ask an analytical or application question. Explore implications or alternatives.",
        }
        instruction = level_instructions.get(level, level_instructions["factual"])
        history_text = ""
        if history:
            recent = history[-4:]
            history_text = "\n".join(
                f"Q{h['question_number']}: {h['question']}\nA: {h.get('answer','')}" for h in recent
            )

        angles = [
            "Focus on a specific detail or mechanism.",
            "Ask about the purpose or motivation behind it.",
            "Ask how it compares to an alternative approach.",
            "Ask about a limitation or potential challenge.",
            "Ask the student to walk through the process step by step.",
            "Ask what would happen if a key assumption changed.",
            "Ask about real-world implications of this concept.",
            "Ask the student to define a key term in their own words.",
        ]
        angle = random.choice(angles)

        already_asked = [h["question"] for h in history] if history else []
        avoid_text = ""
        if already_asked:
            avoid_text = "\nDo NOT repeat or closely paraphrase these already-asked questions:\n" + \
                         "\n".join(f"- {q}" for q in already_asked[-6:])

        prompt = f"""You are an academic viva voce examiner. Student: {student_name}.

This is question {question_number} of 10.
Level: {level.upper()} — {instruction}
Angle: {angle}

Knowledge concept being examined:
---
{node_content[:2000]}
---

Recent exchange:
{history_text}
{avoid_text}

Generate EXACTLY ONE clear, specific viva question based on the concept above.
The question must:
- Come directly from the content above
- Be academically rigorous but fair
- Be answerable by a student who did this work
- Be a complete, natural sentence ending with a question mark
- NOT reveal the answer
- Be DIFFERENT from any question already asked above

Return ONLY the question. No preamble, no numbering, no quotes."""

        return await self.chat(prompt, max_tokens=200, temperature=0.95)

    async def generate_followup(self, original_question, student_answer, node_content, student_name):
        prompt = f"""You are a supportive academic viva examiner. Student: {student_name}.

The student gave an incomplete or unclear answer and needs a follow-up probe.

Concept being examined:
---
{node_content[:1500]}
---

Original question: {original_question}
Student's answer: {student_answer}

Generate ONE short follow-up question that:
- Is gentler and more scaffolded than the original
- Guides the student toward the answer without giving it away
- Starts with an encouraging phrase like "Let me rephrase that..." or "Think about..." or "Can you tell me more about..."
- Ends with a question mark
- Is 1-2 sentences maximum

Return ONLY the follow-up question. No preamble, no quotes."""

        return await self.chat(prompt, max_tokens=150, temperature=0.8)

    async def evaluate_answer(self, question, answer, node_content, level):
        prompt = f"""You are an academic viva voce examiner evaluating a spoken answer.

Concept being tested:
---
{node_content[:1500]}
---

Question asked: {question}
Student's spoken answer: {answer}
Question level: {level}

Evaluate the answer on FOUR dimensions and return a JSON object:
{{
  "content_marks": <0-10>,
  "confidence_score": <0-10>,
  "english_score": <0-10>,
  "presence_score": <0-10>,
  "feedback": "<one sentence of constructive feedback — do NOT reveal the full answer>",
  "quality": "excellent|good|partial|poor",
  "tone": "confident|hesitant|nervous|clear|confused"
}}

Scoring guide:
- content_marks: 9-10 fully correct+detailed, 7-8 mostly correct, 5-6 partially correct, 3-4 minimal, 0-2 wrong/blank
- confidence_score: 9-10 assertive clear statements; 7-8 mostly direct; 5-6 some hedging; 3-4 heavy hedging; 1-2 complete uncertainty
- english_score: 9-10 fluent varied vocabulary; 7-8 good with minor errors; 5-6 understandable but basic; 3-4 frequent errors; 1-2 very poor
- presence_score: 9-10 elaborated beyond minimum, on topic, composed; 7-8 decent attempt; 5-6 answered but brief; 3-4 off-topic; 1-2 gave up

Return ONLY valid JSON."""

        raw = await self.chat(prompt, max_tokens=400, temperature=0.3)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```[a-z]*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw)
        try:
            result = json.loads(raw)
            result.setdefault("content_marks",    5)
            result.setdefault("confidence_score",  5)
            result.setdefault("english_score",     5)
            result.setdefault("presence_score",    5)
            result.setdefault("feedback", "Thank you for your answer.")
            result.setdefault("quality",  "partial")
            result.setdefault("tone",     "clear")
            return result
        except Exception:
            lower = answer.lower().strip()
            is_blank = not lower or lower in ("i don't know", "idk", "don't know", "no idea", "[skipped]", "skip")
            if is_blank:
                return {
                    "content_marks": 0, "confidence_score": 1,
                    "english_score": 3, "presence_score": 1,
                    "feedback": "Try to attempt an answer even if unsure — partial knowledge earns credit.",
                    "quality": "poor", "tone": "hesitant"
                }
            return {
                "content_marks": 5, "confidence_score": 5,
                "english_score": 5, "presence_score": 5,
                "feedback": "Thank you for your answer.", "quality": "partial", "tone": "clear"
            }

    async def generate_final_evaluation(self, student_name, question_log, graph_summary):
        answered = [q for q in question_log if q.get("answer") and q["answer"] not in ("", "[QUIT]")]

        factual_qs       = [q for q in answered if q.get("level") == "factual"]
        understanding_qs = [q for q in answered if q.get("level") == "understanding"]
        application_qs   = [q for q in answered if q.get("level") == "application"]

        def avg(lst, key, default=5):
            vals = [q.get(key, default) for q in lst if q.get(key) is not None]
            return round(sum(vals) / len(vals)) if vals else default

        knowledge_raw      = avg(factual_qs or answered, "content_marks")
        deeper             = understanding_qs + application_qs
        understanding_raw  = avg(deeper or answered, "content_marks")
        confidence_raw     = avg(answered, "confidence_score")
        presence_raw       = avg(answered, "presence_score")
        contribution_src   = application_qs or answered
        contribution_raw   = round((avg(contribution_src, "content_marks") + avg(contribution_src, "presence_score")) / 2)

        qa_text = "\n\n".join(
            f"Q{q['question_number']} ({q.get('level','?')}): {q['question']}\n"
            f"Answer: {q.get('answer','')}\n"
            f"Feedback: {q.get('feedback','')}\n"
            f"Content: {q.get('content_marks','?')}/10 | "
            f"Confidence: {q.get('confidence_score','?')}/10 | "
            f"English: {q.get('english_score','?')}/10 | "
            f"Presence: {q.get('presence_score','?')}/10 | "
            f"Tone: {q.get('tone','?')}"
            for q in question_log
        )

        prompt = f"""You are completing a viva voce evaluation for student: {student_name}.

Pre-computed rubric scores (do NOT change these numbers):
- Knowledge:        {knowledge_raw}/10
- Understanding:    {understanding_raw}/10
- Confidence:       {confidence_raw}/10
- Presence of mind: {presence_raw}/10
- Contribution:     {contribution_raw}/10

Full answer log:
{qa_text}

Provide:
1. Two specific strong areas
2. Two specific areas to improve
3. overall_comment: A short overall performance summary formatted as EXACTLY two paragraphs (no bullet points and no section headers anywhere, 4-6 sentences total, 2-3 sentences per paragraph).

Paragraph 1 — Performance summary + strongest area:
- Start with "Overall, you scored {st + hd + qa}/30..." (where {st + hd + qa} is the total score).
- State the score, grade band (Excellent (27-30) / Good (22-26) / Satisfactory (16-21) / Needs Improvement (10-15) / Unsatisfactory (0-9)), and name the SPECIFIC topic/question where the student did best and briefly why (e.g. "your strongest answers were on regression analysis, where you clearly explained the statistical methods used").

Paragraph 2 — Weakest area + one improvement tip:
- Start with "Where you lost the most marks was..."
- Name the SPECIFIC topic/question that was weakest, briefly say what was missing, then give ONE concrete tip for improvement.

Forbidden in overall_comment:
- Bullet points anywhere
- Headers like "Strengths:" or "Weaknesses:" or "Areas to Review:"
- Generic praise/criticism without naming the specific question/topic it relates to
- Repeating the per-question feedback verbatim

Return ONLY this JSON:
{{
  "strong_areas":     ["specific strength 1", "specific strength 2"],
  "areas_to_improve": ["actionable improvement 1", "actionable improvement 2"],
  "overall_comment":  "Paragraph 1 text\\n\\nParagraph 2 text"
}}"""

        raw = await self.chat(prompt, max_tokens=500, temperature=0.7)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```[a-z]*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw)
        try:
            qualitative = json.loads(raw)
        except Exception:
            qualitative = {
                "strong_areas": ["Subject knowledge", "Attempt to engage with questions"],
                "areas_to_improve": ["Answer confidence", "Elaboration depth"],
                "overall_comment": f"{student_name} completed the viva examination."
            }

        return {
            "knowledge":        knowledge_raw,
            "understanding":    understanding_raw,
            "confidence":       confidence_raw,
            "application":      presence_raw,
            "contribution":     contribution_raw,
            "strong_areas":     qualitative.get("strong_areas", []),
            "areas_to_improve": qualitative.get("areas_to_improve", []),
            "overall_comment":  qualitative.get("overall_comment", ""),
        }


hermes_client = HermesClient()
