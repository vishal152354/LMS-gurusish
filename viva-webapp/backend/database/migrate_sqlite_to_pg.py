"""
One-time copy of the SQLite database into PostgreSQL.

    DATABASE_URL=postgresql://localhost/pariksha ./venv/bin/python -m backend.database.migrate_sqlite_to_pg

Opens SQLite read-only, empties the PostgreSQL app tables, copies every row (converting
0/1 flags, timestamps, JSON text and numbers to proper types), checks the row counts match,
then fills the results reporting tables. Safe to run again: each run starts from empty tables.
"""
import json, os, re, sqlite3, sys
from datetime import datetime

from . import db
from ..services import results_sync

TABLES = ["admins", "professors", "students", "uploads", "viva_events", "event_students", "event_slots",
          "viva_sessions", "marks", "integrity_log", "queue", "orchestrator_log", "notifications",
          "prep_sets", "prep_items", "prep_progress", "active_sessions"]

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def _pg_columns(conn, table):
    rows = conn.execute(
        "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name=? ORDER BY ordinal_position", (table,)).fetchall()
    return {r["column_name"]: (r["data_type"], r["is_nullable"] == "YES", r["column_default"] is not None) for r in rows}


def _convert(value, data_type, problems, where):
    if value is None:
        return None
    if data_type == "boolean":
        if isinstance(value, str):
            return value.strip().lower() in ("1", "true", "t", "yes")
        return bool(value)
    if data_type.startswith("timestamp"):
        s = str(value).strip()
        if not s:
            return None
        try:
            datetime.fromisoformat(s.replace("Z", "+00:00"))
            return s
        except ValueError:
            problems.append(f"{where}: unreadable timestamp {s!r} → NULL")
            return None
    if data_type == "date":
        s = str(value).strip()
        if DATE_RE.match(s):
            return s[:10]
        problems.append(f"{where}: unreadable date {s!r}")
        return None
    if data_type == "jsonb":
        s = value if isinstance(value, str) else json.dumps(value)
        if not s.strip():
            return None
        try:
            json.loads(s)
            return s
        except ValueError:
            problems.append(f"{where}: not JSON, stored as a JSON string")
            return json.dumps(s)
    if data_type in ("integer", "smallint", "bigint"):
        if value == "":
            return None
        return int(float(value))
    if data_type == "numeric":
        if value == "":
            return None
        return float(value)
    return str(value) if not isinstance(value, str) else value


def main():
    if not db.IS_PG:
        sys.exit("Set DATABASE_URL=postgresql://… first.")
    print(f"From: SQLite {db.DB_PATH}\nTo:   {db.describe()}\n")
    db.init_db()                                           # make sure the schema exists
    src = sqlite3.connect(f"file:{db.DB_PATH}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row
    dst = db.get_conn()

    dst.execute("TRUNCATE " + ", ".join(TABLES) + ", pariksha.test_results, pariksha.test_result_answers")
    problems, report = [], []
    for table in TABLES:
        exists = src.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
        if not exists:
            report.append((table, 0, 0, "not in SQLite"))
            continue
        cols = _pg_columns(dst, table)
        rows = src.execute(f"SELECT * FROM {table}").fetchall()
        dropped = set()
        copied = 0
        for r in rows:
            values = {}
            for k in r.keys():
                if k not in cols:
                    dropped.add(k)
                    continue
                data_type, nullable, has_default = cols[k]
                v = _convert(r[k], data_type, problems, f"{table}.{k}")
                if v is None and not nullable:
                    if has_default:
                        continue                           # let PostgreSQL fill its default
                    v = "" if data_type == "text" else v
                values[k] = v
            names = list(values)
            dst.execute(f"INSERT INTO {table} ({', '.join(names)}) VALUES ({', '.join('?' * len(names))})",
                        tuple(values[n] for n in names))
            copied += 1
        pg_count = dst.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        note = ("ignored old columns: " + ", ".join(sorted(dropped))) if dropped else ""
        report.append((table, len(rows), pg_count, note))

    print(f"{'table':18} {'sqlite':>7} {'postgres':>9}")
    ok = True
    for table, n_src, n_dst, note in report:
        flag = "" if n_src == n_dst else "   ← MISMATCH"
        ok &= n_src == n_dst
        print(f"{table:18} {n_src:>7} {n_dst:>9}{flag}  {note}")
    if problems:
        print(f"\n{len(problems)} value(s) needed fixing:")
        for p in problems[:30]:
            print("  -", p)
    synced = results_sync.backfill()
    print(f"\nResults tables: {synced} finished attempt(s) synced to pariksha.test_results")
    dst.close()
    src.close()
    print("\nAll row counts match." if ok else "\nRow counts differ — check the table above.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
