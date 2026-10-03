import os, re, json, uuid
from datetime import datetime
from pathlib import Path

SESSIONS_ROOT = os.path.expanduser("~/.hermes/workspace/viva-sessions")

# ─── helpers ────────────────────────────────────────────────────────────────

def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")

def _ts() -> str:
    return datetime.utcnow().strftime("%Y%m%d_%H%M%S")

def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"

def _safe_name(filename: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", filename)

# ─── extract text ───────────────────────────────────────────────────────────

def extract_text(file_path: str, filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        return _extract_pdf(file_path)
    elif ext == ".docx":
        return _extract_docx(file_path)
    else:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()

def _extract_pdf(path: str) -> str:
    try:
        from pypdf import PdfReader
        reader = PdfReader(path)
        pages = []
        for page in reader.pages:
            text = page.extract_text() or ""
            pages.append(text)
        return "\n\n".join(pages)
    except Exception as e:
        return f"[PDF extraction error: {e}]"

def _extract_docx(path: str) -> str:
    try:
        from docx import Document
        doc = Document(path)
        return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except Exception as e:
        return f"[DOCX extraction error: {e}]"

# ─── OKF pipeline progress tracker ──────────────────────────────────────────

_pipeline_state: dict = {}

def get_pipeline_status(upload_id: str) -> dict:
    return _pipeline_state.get(upload_id, {
        "step": 0, "step_name": "Queued", "percentage": 0,
        "okf_ready": False, "message": "Waiting to start"
    })

def _set_status(upload_id: str, step: int, name: str, pct: int, msg: str, ready: bool = False):
    _pipeline_state[upload_id] = {
        "step": step, "step_name": name, "percentage": pct,
        "okf_ready": ready, "message": msg
    }

# ─── main pipeline ──────────────────────────────────────────────────────────

async def run_pipeline(
    roll_number: str,
    student_name: str,
    filename: str,
    file_path: str,
    upload_id: str,
    hermes_client,
    db_upload_id: str,
) -> dict:
    import asyncio
    from .graph_builder import build_graph

    student_dir_name = f"{roll_number}_{_slug(student_name)}"
    upload_dir_name  = f"{upload_id}_{_safe_name(filename)}"
    base = Path(SESSIONS_ROOT) / student_dir_name / "uploads" / upload_dir_name

    original_dir   = base / "original"
    okf_dir        = base / "okf-bundle"
    transcript_dir = base / "transcript"
    eval_dir       = base / "evaluation"

    for d in [original_dir, okf_dir, transcript_dir, eval_dir]:
        d.mkdir(parents=True, exist_ok=True)

    # copy original file
    import shutil
    dest = original_dir / _safe_name(filename)
    shutil.copy2(file_path, str(dest))

    _set_status(db_upload_id, 1, "Reading content", 10, "Extracting text from your document...")
    await asyncio.sleep(0.3)

    # Step 1 — extract text
    text = extract_text(file_path, filename)
    if not text.strip():
        _set_status(db_upload_id, 1, "Error", 0, "Could not extract text from file.")
        return {"ok": False, "error": "Empty content"}

    word_count = len(text.split())
    _set_status(db_upload_id, 2, "Building OKF bundle", 25,
                f"Analysing {word_count} words — converting to OKF knowledge bundle...")

    # Step 2 — save sampled text for Hermes to read (cap at ~25k chars)
    # Smart sampling: take chunks from beginning, middle, and end
    MAX_CHARS = 25_000
    if len(text) > MAX_CHARS:
        chunk = MAX_CHARS // 3
        sampled = (
            text[:chunk] + "\n\n[...middle section...]\n\n" +
            text[len(text)//2 - chunk//2 : len(text)//2 + chunk//2] +
            "\n\n[...final section...]\n\n" +
            text[-chunk:]
        )
    else:
        sampled = text
    source_txt = original_dir / "source.txt"
    source_txt.write_text(sampled, encoding="utf-8")

    _set_status(db_upload_id, 2, "Building OKF bundle", 30,
                "Building knowledge bundle — this takes 1-3 minutes for large books...")

    # Step 3 — attempt OKF bundle production via Hermes OKF skill
    hermes_ok = await hermes_client.produce_okf_bundle(
        source_path=str(source_txt),
        bundle_dir=str(okf_dir),
        filename=filename,
        timeout=180,
    )

    if hermes_ok:
        _set_status(db_upload_id, 3, "Parsing OKF bundle", 55,
                    "OKF bundle created — parsing knowledge files...")
        await asyncio.sleep(0.2)
        all_items, data = _read_okf_bundle(okf_dir, filename)
        if not all_items:
            hermes_ok = False  # Hermes wrote nothing valid; fall through to LLM fallback

    if not hermes_ok:
        # Fallback: use old LLM prompt approach with truncated text
        _set_status(db_upload_id, 3, "Identifying concepts (fallback)", 40,
                    "OKF skill unavailable — using direct analysis...")
        concept_prompt = f"""You are an academic knowledge extraction system.
Read the following document and identify ALL major concepts, methods, findings, conclusions.
You MUST specifically extract the exact statistical results and study values, including:
- Final sample size (N), sampling method, and target demographics (under 'methods' or 'concepts')
- Cronbach Alpha reliability values for all constructs and variables, noting which variable was dropped due to low alpha (under 'methods' or 'concepts')
- Regression equation, Adjusted R-square value, significant variables with their Beta coefficients and p-values, and VIF values (under 'findings' or 'methods')
- All tested hypotheses (H1 to HN) and whether they were supported, rejected, or partially supported (under 'findings' or 'concepts')
- Cluster analysis method, number of clusters, sizes of each cluster (number of respondents), and cluster descriptions/profiles (under 'findings')
- Key recommendations for practitioners, directly linking them to specific statistical results (under 'findings' or 'conclusion')

Return a JSON object:
{{
  "title": "inferred title",
  "summary": "2-3 sentence overview",
  "concepts": [{{"id":"slug","title":"Title","description":"one sentence","tags":["t"],"content":"2-5 paragraphs containing exact numbers and values from the text","key_points":["p1","p2","p3"],"importance":"high|medium|low"}}],
  "methods": [...same...],
  "findings": [...same...],
  "conclusion": {{"id":"conclusion","title":"Conclusion","description":"summary","content":"full text","key_points":[],"tags":["conclusion"],"importance":"high"}}
}}
Extract 8-15 items total. Each must have unique kebab-case id, title, description, tags array, content, key_points array (3+), importance.
Document:
---
{sampled}
---
Return ONLY valid JSON. No markdown fences."""
        concepts_json = await hermes_client.chat(concept_prompt, max_tokens=4000)
        try:
            raw = concepts_json.strip()
            if raw.startswith("```"):
                raw = re.sub(r"^```[a-z]*\n?", "", raw)
                raw = re.sub(r"\n?```$", "", raw)
            data = json.loads(raw)
        except json.JSONDecodeError:
            m = re.search(r'\{[\s\S]+\}', concepts_json)
            data = json.loads(m.group()) if m else _fallback_concepts(text, filename)

        _set_status(db_upload_id, 3, "Building OKF bundle", 55, "Writing knowledge bundle files...")
        await asyncio.sleep(0.2)

        all_items = []
        for category in ["concepts", "methods", "findings"]:
            items = data.get(category, [])
            if isinstance(items, list):
                all_items.extend(items)
        conclusion = data.get("conclusion")
        if conclusion and isinstance(conclusion, dict):
            all_items.append(conclusion)

        # ensure unique ids
        seen_ids: set = set()
        for item in all_items:
            item_id = item.get("id", _slug(item.get("title", "item")))
            if item_id in seen_ids:
                item_id = f"{item_id}-{uuid.uuid4().hex[:4]}"
            item["id"] = item_id
            seen_ids.add(item_id)

        for item in all_items:
            _write_okf_file(okf_dir, item, all_items)
        _write_index(okf_dir, data, all_items, student_name, filename)

    # ensure index.md exists (Hermes writes it; write a fallback if missing)
    index_path = okf_dir / "index.md"
    if not index_path.exists():
        _write_index(okf_dir, data, all_items, student_name, filename)

    log_path = okf_dir / "log.md"
    log_path.write_text(
        f"# Change Log\n- {_now_iso()} Bundle created from {filename}\n"
    )

    _set_status(db_upload_id, 4, "Building knowledge graph", 75, "Connecting concepts into a graph...")
    await asyncio.sleep(0.2)

    # Step 4 — build knowledge graph
    student_id = f"{roll_number}_{_slug(student_name)}"
    graph = build_graph(all_items, student_id, upload_id, filename)

    graph_path = base / "knowledge-graph.json"
    graph_path.write_text(json.dumps(graph, indent=2))

    summary_path = base / "knowledge-graph-summary.md"
    _write_graph_summary(summary_path, graph, student_name)

    # update log
    with open(log_path, "a") as f:
        f.write(f"- {_now_iso()} Knowledge graph built\n")

    _set_status(db_upload_id, 5, "Ready", 100, "Knowledge base ready!", ready=True)

    return {
        "ok": True,
        "bundle_path": str(okf_dir),
        "graph_path": str(graph_path),
        "node_count": len(graph["nodes"]),
        "upload_dir": str(base),
        "student_dir": str(Path(SESSIONS_ROOT) / f"{roll_number}_{_slug(student_name)}"),
    }

# ─── OKF file writers ────────────────────────────────────────────────────────

def _write_okf_file(okf_dir: Path, item: dict, all_items: list):
    item_id = item["id"]
    title = item.get("title", item_id)
    desc  = item.get("description", "")
    tags  = item.get("tags", [])
    content = item.get("content", "")
    key_points = item.get("key_points", [])
    importance = item.get("importance", "medium")
    today = datetime.utcnow().strftime("%Y-%m-%d")

    # related concepts = other items
    related = [i for i in all_items if i["id"] != item_id][:4]
    related_links = "\n".join(f"- [{i['title']}]({i['id']}.md)" for i in related)

    key_points_md = "\n".join(f"- {p}" for p in key_points)

    tags_str = ", ".join(tags) if isinstance(tags, list) else str(tags)

    body = f"""---
type: concept
title: {title}
description: {desc}
tags: [{tags_str}]
timestamp: {today}
importance: {importance}
---

# {title}

{content}

## Key Points
{key_points_md}

## Related Concepts
{related_links}
"""
    (okf_dir / f"{item_id}.md").write_text(body)

def _write_index(okf_dir: Path, data: dict, all_items: list, student_name: str, filename: str):
    title_line = f"# Knowledge Bundle — {student_name} — {filename}\n\n"
    summary = data.get("summary", "")
    lines = ['---\nokf_version: "0.1"\n---\n\n', title_line, f"{summary}\n\n"]

    def section(heading, items):
        if not items:
            return ""
        out = f"## {heading}\n"
        for i in items:
            out += f"* [{i['title']}]({i['id']}.md) - {i.get('description','')}\n"
        return out + "\n"

    lines.append(section("Core Concepts",      data.get("concepts",  [])))
    lines.append(section("Methods and Approaches", data.get("methods", [])))
    lines.append(section("Findings and Results",   data.get("findings", [])))
    if data.get("conclusion"):
        c = data["conclusion"]
        lines.append(f"## Conclusion\n* [{c['title']}]({c['id']}.md) - {c.get('description','')}\n")

    (okf_dir / "index.md").write_text("".join(lines))

def _write_graph_summary(path: Path, graph: dict, student_name: str):
    nodes = graph["nodes"]
    edges = graph["edges"]
    entry = graph.get("entry_node", "")

    # suggested path
    high   = [n for n in nodes if n["importance"] == "high"]
    medium = [n for n in nodes if n["importance"] == "medium"]
    low    = [n for n in nodes if n["importance"] == "low"]

    path_nodes = (high + medium + low)[:10]
    q1_3  = path_nodes[:3]
    q4_7  = path_nodes[3:7]
    q8_10 = path_nodes[7:10]

    lines = [f"# Knowledge Graph Summary — {student_name}\n"]
    lines.append(f"## Overview\nTotal concepts: {len(nodes)}\nTotal relationships: {len(edges)}\nEntry point: {entry}\n\n")

    lines.append("## Concept Map\n")
    for node in nodes:
        targets = [e["target"] for e in edges if e["source"] == node["id"]]
        if targets:
            lines.append(f"[{node['title']}] → connects to → {', '.join(targets)}\n")

    lines.append("\n## Suggested Viva Path (10 questions)\n")
    lines.append(f"Q1-Q3: {', '.join(n['title'] for n in q1_3)}\n")
    lines.append(f"Q4-Q7: {', '.join(n['title'] for n in q4_7)}\n")
    lines.append(f"Q8-Q10: {', '.join(n['title'] for n in q8_10)}\n\n")

    # Append node contents in detail
    lines.append("## Detailed Node Contents (KNOWLEDGE SOURCE)\n")
    bundle_dir = path.parent / "okf-bundle"
    for node in nodes:
        node_file = bundle_dir / f"{node['id']}.md"
        if node_file.exists():
            content = node_file.read_text(encoding="utf-8", errors="replace")
            # Strip YAML frontmatter for cleaner content in context
            if content.startswith("---"):
                end = content.find("\n---", 3)
                if end != -1:
                    content = content[end + 4:].strip()
            lines.append(f"### Node: {node['title']} ({node['id']})\n{content}\n\n")

    path.write_text("".join(lines))

def _parse_frontmatter(content: str) -> tuple[dict, str]:
    """Parse YAML frontmatter from an OKF .md file. Returns (meta, body)."""
    if not content.startswith("---"):
        return {}, content
    end = content.find("\n---", 3)
    if end == -1:
        return {}, content
    fm_text = content[3:end].strip()
    body = content[end + 4:].strip()
    meta: dict = {}
    for line in fm_text.splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            meta[k.strip()] = v.strip().strip('"').strip("'")
    # parse tags array: [a, b, c] or [a,b]
    raw_tags = meta.get("tags", "")
    if raw_tags.startswith("[") and raw_tags.endswith("]"):
        meta["tags"] = [t.strip().strip('"').strip("'") for t in raw_tags[1:-1].split(",") if t.strip()]
    else:
        meta["tags"] = [raw_tags] if raw_tags else []
    return meta, body


def _read_okf_bundle(okf_dir: Path, filename: str) -> tuple[list, dict]:
    """
    Read OKF .md files from bundle directory and return (all_items, data_dict).
    Skips reserved files (index.md, log.md) and files without a `type` field.
    """
    RESERVED = {"index.md", "log.md"}
    all_items: list = []
    seen_ids: set = set()

    for md_file in sorted(okf_dir.glob("*.md")):
        if md_file.name in RESERVED:
            continue
        content = md_file.read_text(encoding="utf-8", errors="replace")
        meta, body = _parse_frontmatter(content)
        if not meta.get("type"):
            continue  # OKF §9 violation — skip

        # extract key points from body
        key_points: list = []
        in_kp = False
        for line in body.splitlines():
            if re.match(r"^#+\s+key\s+points?", line, re.IGNORECASE):
                in_kp = True
                continue
            if in_kp:
                if line.startswith("#"):
                    break
                m = re.match(r"^\s*[-*]\s+(.*)", line)
                if m:
                    key_points.append(m.group(1).strip())

        # strip key points / related concepts sections from body for cleaner content
        content_body = re.split(r"\n#+\s+(Key Points?|Related Concepts?)", body, flags=re.IGNORECASE)[0].strip()

        item_id = md_file.stem
        if item_id in seen_ids:
            item_id = f"{item_id}-{uuid.uuid4().hex[:4]}"
        seen_ids.add(item_id)

        all_items.append({
            "id": item_id,
            "title": meta.get("title", item_id.replace("-", " ").title()),
            "description": meta.get("description", ""),
            "tags": meta.get("tags", []),
            "content": content_body,
            "key_points": key_points or ["See document for details"],
            "importance": meta.get("importance", "medium"),
        })

    # read summary from index.md if present
    summary = ""
    index_file = okf_dir / "index.md"
    if index_file.exists():
        _, idx_body = _parse_frontmatter(index_file.read_text(encoding="utf-8", errors="replace"))
        # first non-heading paragraph
        for line in idx_body.splitlines():
            line = line.strip()
            if line and not line.startswith("#") and not line.startswith("*"):
                summary = line
                break

    if not all_items:
        # OKF production wrote nothing useful — trigger fallback in caller
        return [], {"title": filename, "summary": "", "concepts": [], "methods": [], "findings": [], "conclusion": None}

    data = {
        "title": filename,
        "summary": summary,
        "concepts": all_items,
        "methods": [],
        "findings": [],
        "conclusion": None,
    }
    return all_items, data


def _fallback_concepts(text: str, filename: str) -> dict:
    paragraphs = [p.strip() for p in text.split("\n\n") if len(p.strip()) > 50][:8]
    concepts = []
    for i, para in enumerate(paragraphs[:6]):
        words = para.split()[:6]
        title = " ".join(words).title()
        concepts.append({
            "id": f"concept-{i+1}",
            "title": title,
            "description": para[:100],
            "tags": ["general"],
            "content": para,
            "key_points": [para[:60]],
            "importance": "medium"
        })
    return {
        "title": filename,
        "summary": f"Document extracted from {filename}",
        "concepts": concepts,
        "methods": [],
        "findings": [],
        "conclusion": {
            "id": "conclusion",
            "title": "Conclusion",
            "description": "Summary of the document",
            "content": paragraphs[-1] if paragraphs else "No conclusion found.",
            "key_points": ["See document for details"],
            "tags": ["conclusion"],
            "importance": "high"
        }
    }
