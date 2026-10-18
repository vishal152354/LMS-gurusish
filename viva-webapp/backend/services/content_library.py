"""
The content library: documents the admin uploads for every teacher to build tests from.

Teachers can only read the library; uploading, renaming and deleting are admin actions.
A test can draw on several library items (viva_events.upload_ids, JSON list; upload_id
keeps the first one for older code paths).
"""
import json, logging, os, re, shutil
from datetime import datetime
from pathlib import Path

from fastapi import HTTPException

from ..database.db import get_conn
from .hermes_client import hermes_client
from .okf_pipeline import run_pipeline, get_pipeline_status

log = logging.getLogger(__name__)

UPLOADS_DIR = Path(os.path.expanduser("~/viva-webapp/data/professor-uploads"))
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def _safe(filename: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", filename)


def store_upload(owner_id: str, owner_name: str, filename: str, raw: bytes, background_tasks) -> dict:
    """Save a document into the library and start building its knowledge graph."""
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    safe_fn = _safe(filename)
    upload_id = f"{ts}_{safe_fn}"
    dest_dir = UPLOADS_DIR / owner_id / upload_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / safe_fn
    dest_path.write_bytes(raw)

    conn = get_conn()
    conn.execute(
        """INSERT INTO uploads
           (id, student_id, professor_id, filename, upload_path,
            okf_bundle_path, graph_path, okf_ready, viva_completed, uploaded_at, display_name, is_library)
           VALUES (?,NULL,?,?,?,?,?,0,0,?,?,1)""",
        (upload_id, owner_id, filename, str(dest_path), "", "", datetime.utcnow().isoformat(), filename),
    )
    conn.commit()
    conn.close()

    async def _run():
        result = await run_pipeline(owner_id, owner_name, filename, str(dest_path), ts, hermes_client, upload_id)
        if result.get("ok"):
            c2 = get_conn()
            c2.execute("UPDATE uploads SET okf_bundle_path=?,graph_path=?,okf_ready=1 WHERE id=?",
                       (result["bundle_path"], result["graph_path"], upload_id))
            c2.commit()
            c2.close()

    background_tasks.add_task(_run)
    return {"upload_id": upload_id, "filename": filename, "status_url": f"/student/pipeline/status/{upload_id}"}


def list_library() -> list:
    conn = get_conn()
    rows = conn.execute("SELECT * FROM uploads WHERE is_library=1 ORDER BY uploaded_at DESC").fetchall()
    usage = {}
    for e in conn.execute("SELECT upload_id, upload_ids FROM viva_events").fetchall():
        for uid in event_upload_ids(e):
            usage[uid] = usage.get(uid, 0) + 1
    conn.close()
    out = []
    for u in rows:
        st = get_pipeline_status(u["id"])
        out.append({
            "upload_id": u["id"],
            "filename": u["filename"],
            "display_name": u["display_name"] or u["filename"],
            "okf_ready": bool(u["okf_ready"]),
            "uploaded_at": u["uploaded_at"],
            "step": st.get("step", 0),
            "percentage": st.get("percentage", 0),
            "label": st.get("label", ""),
            "test_count": usage.get(u["id"], 0),
        })
    return out


def library_uploads(conn, upload_ids: list) -> list:
    """The requested library items, in the order given; 404 if any is missing."""
    out = []
    for uid in upload_ids:
        u = conn.execute("SELECT * FROM uploads WHERE id=? AND is_library=1", (uid,)).fetchone()
        if not u:
            raise HTTPException(404, "One of the chosen content items no longer exists.")
        out.append(u)
    return out


def event_upload_ids(e) -> list:
    try:
        if "upload_ids" in e.keys() and e["upload_ids"]:
            ids = json.loads(e["upload_ids"])
            if isinstance(ids, list) and ids:
                return ids
    except Exception:
        pass
    return [e["upload_id"]] if e["upload_id"] else []


def content_names(conn, e) -> str:
    names = []
    for uid in event_upload_ids(e):
        u = conn.execute("SELECT display_name, filename FROM uploads WHERE id=?", (uid,)).fetchone()
        if u:
            names.append(u["display_name"] or u["filename"])
    return ", ".join(names)


def rename_upload(upload_id: str, display_name: str) -> dict:
    display_name = display_name.strip()
    if not display_name:
        raise HTTPException(400, "Display name cannot be empty")
    conn = get_conn()
    cur = conn.execute("UPDATE uploads SET display_name=? WHERE id=? AND is_library=1", (display_name, upload_id))
    conn.commit()
    conn.close()
    if not cur.rowcount:
        raise HTTPException(404, "Content not found")
    return {"ok": True, "display_name": display_name}


def delete_upload(upload_id: str) -> dict:
    conn = get_conn()
    using = [e["title"] for e in conn.execute("SELECT title, upload_id, upload_ids FROM viva_events").fetchall()
             if upload_id in event_upload_ids(e)]
    if using:
        conn.close()
        raise HTTPException(400, f"This content is used by test(s): {', '.join(using)}. Those tests must be deleted first.")
    upload = conn.execute("SELECT * FROM uploads WHERE id=? AND is_library=1", (upload_id,)).fetchone()
    if not upload:
        conn.close()
        raise HTTPException(404, "Content not found")
    conn.execute("DELETE FROM uploads WHERE id=?", (upload_id,))
    conn.commit()
    conn.close()

    # Remove the files (best effort)
    for path, is_dir in ((upload["upload_path"] and os.path.dirname(upload["upload_path"]), True),
                         (upload["okf_bundle_path"], True)):
        try:
            if path and os.path.isdir(path):
                shutil.rmtree(path)
        except Exception as e:
            log.error("Failed to delete %s: %s", path, e)
    graph_path = upload["graph_path"]
    if graph_path:
        try:
            for p in (graph_path, graph_path.replace("knowledge-graph.json", "summary.txt")):
                if os.path.exists(p):
                    os.remove(p)
            parent = os.path.dirname(graph_path)
            if os.path.isdir(parent) and not os.listdir(parent):
                os.rmdir(parent)
        except Exception as e:
            log.error("Failed to delete graph files: %s", e)
    return {"ok": True}
