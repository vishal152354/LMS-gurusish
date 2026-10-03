import json
from typing import List, Dict

def build_graph(items: List[Dict], student_id: str, upload_id: str, filename: str) -> Dict:
    nodes = []
    edges = []
    seen_edges = set()

    for item in items:
        nodes.append({
            "id":          item["id"],
            "title":       item.get("title", item["id"]),
            "description": item.get("description", ""),
            "tags":        item.get("tags", []),
            "file_path":   f"okf-bundle/{item['id']}.md",
            "importance":  item.get("importance", "medium"),
        })

    # build edges from related-concepts cross-referencing
    id_set = {n["id"] for n in nodes}

    # chain items linearly + cross-connect by shared tags
    for i, item in enumerate(items):
        src = item["id"]
        # forward chain
        if i + 1 < len(items):
            tgt = items[i + 1]["id"]
            key = (src, tgt)
            if key not in seen_edges:
                edges.append({"source": src, "target": tgt, "relationship": "leads_to"})
                seen_edges.add(key)
        # cross-link by shared tag
        src_tags = set(item.get("tags", []))
        for other in items:
            if other["id"] == src:
                continue
            if src_tags & set(other.get("tags", [])):
                key2 = (src, other["id"])
                if key2 not in seen_edges:
                    edges.append({"source": src, "target": other["id"], "relationship": "references"})
                    seen_edges.add(key2)

    # entry node = first high-importance or first node
    high_nodes = [n for n in nodes if n["importance"] == "high"]
    entry = high_nodes[0]["id"] if high_nodes else (nodes[0]["id"] if nodes else "")

    import datetime
    return {
        "student_id":   student_id,
        "upload_id":    upload_id,
        "filename":     filename,
        "created_at":   datetime.datetime.utcnow().isoformat() + "Z",
        "total_nodes":  len(nodes),
        "total_edges":  len(edges),
        "entry_node":   entry,
        "nodes":        nodes,
        "edges":        edges,
    }
