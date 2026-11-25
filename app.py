import json
import math
import os
import sqlite3

from flask import Flask, g, jsonify, request # type: ignore

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "dashboard.db")

app = Flask(__name__, static_folder="static", static_url_path="/static")

PRIORITIES = ("low", "medium", "high")
THEMES = ("light", "dark", "ocean", "forest")
TILES = ("tasks", "notes", "pomodoro")

BOARD_TYPES = ("sticky", "text", "rect", "ellipse")
BOARD_COLORS = ("yellow", "orange", "pink", "purple", "blue", "green")
BOARD_RANGES = {            # (min, max) dla pol liczbowych
    "x": (-50000, 50000),
    "y": (-50000, 50000),
    "w": (40, 3000),
    "h": (30, 3000),
}

DEFAULT_SETTINGS = {
    "theme": "light",
    "layout": list(TILES),
    "hidden": [],
    "pomodoro_work": 25,
    "pomodoro_break": 5,
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    priority    TEXT    NOT NULL DEFAULT 'medium',
    done        INTEGER NOT NULL DEFAULT 0,
    category    TEXT    NOT NULL DEFAULT '',
    recur_days  INTEGER NOT NULL DEFAULT 0,
    next_due    TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL DEFAULT 'Nowa notatka',
    content     TEXT    NOT NULL DEFAULT '',
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS pomodoro_sessions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    duration_min     INTEGER NOT NULL,
    completed_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS board_items (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    type  TEXT    NOT NULL,
    x     REAL    NOT NULL DEFAULT 0,
    y     REAL    NOT NULL DEFAULT 0,
    w     REAL    NOT NULL DEFAULT 180,
    h     REAL    NOT NULL DEFAULT 120,
    text  TEXT    NOT NULL DEFAULT '',
    color TEXT    NOT NULL DEFAULT 'yellow',
    z     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS board_links (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id INTEGER NOT NULL REFERENCES board_items(id),
    to_id   INTEGER NOT NULL REFERENCES board_items(id)
);
"""

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()

def init_db():
    """Tworzy tabele i wstawia domyslne ustawienia, jesli ich brak."""
    db = sqlite3.connect(DB_PATH)
    db.executescript(SCHEMA)
    # do juz istniejacych baz danych (ALTER TABLE ignoruje blad jesli kolumna istnieje)
    for col, dflt in [("category", "''"), ("recur_days", "0"), ("next_due", "NULL")]:
        try:
            db.execute(f"ALTER TABLE tasks ADD COLUMN {col} TEXT NOT NULL DEFAULT {dflt}")
        except Exception:
            pass  # kolumna juz istnieje
    for key, value in DEFAULT_SETTINGS.items():
        db.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
            (key, json.dumps(value)),
        )
    db.commit()
    db.close()

def error(message, status=400):
    return jsonify({"error": message}), status

def clean_text(value, max_len):
    """Zwraca przyciety tekst lub None, jesli to nie string."""
    if not isinstance(value, str):
        return None
    return value.strip()[:max_len]

@app.get("/")
def index():
    return app.send_static_file("index.html")

# ===== Zadania =====

def task_to_dict(row):
    return {
        "id": row["id"],
        "title": row["title"],
        "priority": row["priority"],
        "done": bool(row["done"]),
        "category": row["category"] or "",
        "recur_days": row["recur_days"] or 0,
        "next_due": row["next_due"],
        "created_at": row["created_at"],
    }

def _next_due(recur_days):
    """Oblicza date nastepnego wykonania jako string ISO (lub None)."""
    if not recur_days:
        return None
    import datetime
    return (datetime.date.today() + datetime.timedelta(days=recur_days)).isoformat()

@app.get("/api/tasks/categories")
def list_categories():
    """Unikalne kategorie wsrod wszystkich zadan (niepuste)."""
    rows = get_db().execute(
        "SELECT DISTINCT category FROM tasks WHERE category != '' ORDER BY category COLLATE NOCASE"
    ).fetchall()
    return jsonify([r["category"] for r in rows])

@app.get("/api/tasks")
def list_tasks():
    """Lista zadan. Opcjonalnie ?status=active|done&category=X."""
    db = get_db()
    status = request.args.get("status")
    category = request.args.get("category")

    db.execute(
        """UPDATE tasks SET done = 0, next_due = date(next_due, '+' || recur_days || ' days')
           WHERE done = 1 AND recur_days > 0 AND next_due IS NOT NULL
                 AND next_due <= date('now','localtime')"""
    )
    db.commit()

    conditions = []
    params = []
    if status == "active":
        conditions.append("done = 0")
    elif status == "done":
        conditions.append("done = 1")
    if category:
        conditions.append("category = ?")
        params.append(category)

    query = "SELECT * FROM tasks"
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += (
        " ORDER BY done ASC,"
        " CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,"
        " id DESC"
    )
    rows = db.execute(query, params).fetchall()
    return jsonify([task_to_dict(r) for r in rows])


@app.post("/api/tasks")
def create_task():
    data = request.get_json(silent=True) or {}
    title = clean_text(data.get("title"), 200)
    priority = data.get("priority", "medium")
    category = clean_text(data.get("category", ""), 50) or ""
    recur_days = data.get("recur_days", 0)
    if not title:
        return error("Pole 'title' jest wymagane.")
    if priority not in PRIORITIES:
        return error("Priorytet musi byc jednym z: low, medium, high.")
    if not isinstance(recur_days, int) or isinstance(recur_days, bool) or not 0 <= recur_days <= 3650:
        return error("'recur_days' musi byc liczba calkowita 0-3650.")

    next_due = _next_due(recur_days)
    db = get_db()
    cur = db.execute(
        "INSERT INTO tasks (title, priority, category, recur_days, next_due) VALUES (?, ?, ?, ?, ?)",
        (title, priority, category, recur_days, next_due),
    )
    db.commit()
    row = db.execute("SELECT * FROM tasks WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(task_to_dict(row)), 201


@app.put("/api/tasks/<int:task_id>")
def update_task(task_id):
    """Czesciowa aktualizacja: title, priority, done, category, recur_days."""
    db = get_db()
    row = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None:
        return error("Nie znaleziono zadania.", 404)

    data = request.get_json(silent=True) or {}
    title      = row["title"]
    priority   = row["priority"]
    done       = row["done"]
    category   = row["category"] or ""
    recur_days = row["recur_days"] or 0
    next_due   = row["next_due"]

    if "title" in data:
        title = clean_text(data["title"], 200)
        if not title:
            return error("Tytul nie moze byc pusty.")
    if "priority" in data:
        if data["priority"] not in PRIORITIES:
            return error("Niepoprawny priorytet.")
        priority = data["priority"]
    if "done" in data:
        if not isinstance(data["done"], bool):
            return error("Pole 'done' musi byc typu boolean.")
        done = int(data["done"])
    if "category" in data:
        category = clean_text(data["category"], 50) or ""
    if "recur_days" in data:
        rd = data["recur_days"]
        if not isinstance(rd, int) or isinstance(rd, bool) or not 0 <= rd <= 3650:
            return error("'recur_days' musi byc liczba calkowita 0-3650.")
        recur_days = rd
        next_due = _next_due(recur_days) if recur_days else None

    db.execute(
        "UPDATE tasks SET title=?, priority=?, done=?, category=?, recur_days=?, next_due=? WHERE id=?",
        (title, priority, done, category, recur_days, next_due, task_id),
    )
    db.commit()
    row = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return jsonify(task_to_dict(row))


@app.delete("/api/tasks/<int:task_id>")
def delete_task(task_id):
    db = get_db()
    cur = db.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    db.commit()
    return ("", 204) if cur.rowcount else error("Nie znaleziono zadania.", 404)

# ===== Notatki =====

def note_to_dict(row):
    return {
        "id": row["id"],
        "title": row["title"],
        "content": row["content"],
        "updated_at": row["updated_at"],
    }


@app.get("/api/notes")
def list_notes():
    rows = get_db().execute("SELECT * FROM notes ORDER BY updated_at DESC, id DESC").fetchall()
    return jsonify([note_to_dict(r) for r in rows])


@app.post("/api/notes")
def create_note():
    data = request.get_json(silent=True) or {}
    title = clean_text(data.get("title", "Nowa notatka"), 100) or "Nowa notatka"
    content = data.get("content", "")
    if not isinstance(content, str):
        return error("Pole 'content' musi byc tekstem.")
    db = get_db()
    cur = db.execute(
        "INSERT INTO notes (title, content) VALUES (?, ?)", (title, content[:20000])
    )
    db.commit()
    row = db.execute("SELECT * FROM notes WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(note_to_dict(row)), 201


@app.put("/api/notes/<int:note_id>")
def update_note(note_id):
    db = get_db()
    row = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if row is None:
        return error("Nie znaleziono notatki.", 404)
    data = request.get_json(silent=True) or {}
    title = clean_text(data["title"], 100) or "Bez tytulu" if "title" in data else row["title"]
    content = row["content"]
    if "content" in data:
        if not isinstance(data["content"], str):
            return error("Pole 'content' musi byc tekstem.")
        content = data["content"][:20000]
    db.execute(
        "UPDATE notes SET title=?, content=?, updated_at=datetime('now','localtime') WHERE id=?",
        (title, content, note_id),
    )
    db.commit()
    row = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    return jsonify(note_to_dict(row))


@app.delete("/api/notes/<int:note_id>")
def delete_note(note_id):
    db = get_db()
    cur = db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    db.commit()
    return ("", 204) if cur.rowcount else error("Nie znaleziono notatki.", 404)

# ===== Pomodoro =====

@app.get("/api/pomodoro")
def pomodoro_stats():
    db = get_db()
    q = db.execute
    return jsonify({
        "today":         q("SELECT COUNT(*) AS c FROM pomodoro_sessions WHERE date(completed_at)=date('now','localtime')").fetchone()["c"],
        "total":         q("SELECT COUNT(*) AS c FROM pomodoro_sessions").fetchone()["c"],
        "total_minutes": q("SELECT COALESCE(SUM(duration_min),0) AS m FROM pomodoro_sessions").fetchone()["m"],
    })


@app.post("/api/pomodoro")
def pomodoro_add_session():
    """Zapisuje jedna ukonczona sesje pracy."""
    data = request.get_json(silent=True) or {}
    duration = data.get("duration_min")
    if not isinstance(duration, int) or isinstance(duration, bool) or not 1 <= duration <= 180:
        return error("'duration_min' musi byc liczba calkowita 1-180.")
    db = get_db()
    db.execute("INSERT INTO pomodoro_sessions (duration_min) VALUES (?)", (duration,))
    db.commit()
    return pomodoro_stats(), 201

# ===== Ustawienia =====

def read_settings():
    rows = get_db().execute("SELECT key, value FROM settings").fetchall()
    settings = dict(DEFAULT_SETTINGS)
    for r in rows:
        settings[r["key"]] = json.loads(r["value"])
    layout = [t for t in settings["layout"] if t in TILES]
    for i, tile in enumerate(TILES):
        if tile not in layout:
            later = [layout.index(t) for t in TILES[i + 1:] if t in layout]
            layout.insert(min(later) if later else len(layout), tile)
    settings["layout"] = layout
    return settings


@app.get("/api/settings")
def get_settings():
    return jsonify(read_settings())


@app.put("/api/settings")
def update_settings():
    data = request.get_json(silent=True) or {}
    updates = {}

    if "theme" in data:
        if data["theme"] not in THEMES:
            return error("Nieznany motyw.")
        updates["theme"] = data["theme"]

    if "layout" in data:
        layout = data["layout"]
        if not isinstance(layout, list) or sorted(layout) != sorted(TILES):
            return error("'layout' musi zawierac kazdy kafelek dokladnie raz.")
        updates["layout"] = layout

    if "hidden" in data:
        hidden = data["hidden"]
        if not isinstance(hidden, list) or any(t not in TILES for t in hidden):
            return error("'hidden' zawiera nieznany kafelek.")
        updates["hidden"] = sorted(set(hidden))

    for key in ("pomodoro_work", "pomodoro_break"):
        if key in data:
            value = data[key]
            if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 120:
                return error(f"'{key}' musi byc liczba calkowita 1-120.")
            updates[key] = value

    db = get_db()
    for key, value in updates.items():
        db.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, json.dumps(value)),
        )
    db.commit()
    return jsonify(read_settings())

# ===== Tablica (whiteboard) =====

def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

def json_object():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}

def apply_item_fields(item, data):
    for key, (low, high) in BOARD_RANGES.items():
        if key in data:
            value = data[key]
            if not is_number(value) or not low <= value <= high:
                return f"'{key}' musi byc liczba z zakresu {low}-{high}."
            item[key] = value
    if "text" in data:
        if not isinstance(data["text"], str):
            return "Pole 'text' musi byc tekstem."
        item["text"] = data["text"][:2000]
    if "color" in data:
        if data["color"] not in BOARD_COLORS:
            return "Nieznany kolor."
        item["color"] = data["color"]
    if "z" in data:
        z = data["z"]
        if not isinstance(z, int) or isinstance(z, bool) or not 0 <= z <= 1_000_000_000:
            return "'z' musi byc liczba calkowita."
        item["z"] = z
    return None

def board_item_to_dict(row):
    return {key: row[key] for key in ("id", "type", "x", "y", "w", "h", "text", "color", "z")}

def board_link_to_dict(row):
    return {"id": row["id"], "from_id": row["from_id"], "to_id": row["to_id"]}


@app.get("/api/board")
def get_board():
    db = get_db()
    items = db.execute("SELECT * FROM board_items ORDER BY z ASC, id ASC").fetchall()
    links = db.execute("SELECT * FROM board_links ORDER BY id ASC").fetchall()
    return jsonify({
        "items": [board_item_to_dict(r) for r in items],
        "links": [board_link_to_dict(r) for r in links],
    })


@app.delete("/api/board")
def clear_board():
    db = get_db()
    db.execute("DELETE FROM board_links")
    db.execute("DELETE FROM board_items")
    db.commit()
    return "", 204


@app.post("/api/board/items")
def create_board_item():
    data = json_object()
    item_type = data.get("type")
    if item_type not in BOARD_TYPES:
        return error("Typ musi byc jednym z: sticky, text, rect, ellipse.")
    item = {"x": 0, "y": 0, "w": 180, "h": 120, "text": "", "color": "yellow"}
    message = apply_item_fields(item, data)
    if message:
        return error(message)
    db = get_db()
    top = db.execute("SELECT COALESCE(MAX(z), 0) + 1 AS z FROM board_items").fetchone()["z"]
    cur = db.execute(
        "INSERT INTO board_items (type, x, y, w, h, text, color, z) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (item_type, item["x"], item["y"], item["w"], item["h"], item["text"], item["color"], top),
    )
    db.commit()
    row = db.execute("SELECT * FROM board_items WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(board_item_to_dict(row)), 201


@app.put("/api/board/items/<int:item_id>")
def update_board_item(item_id):
    db = get_db()
    row = db.execute("SELECT * FROM board_items WHERE id = ?", (item_id,)).fetchone()
    if row is None: return error("Nie znaleziono elementu.", 404)
    item = board_item_to_dict(row)
    msg = apply_item_fields(item, json_object())
    if msg: return error(msg)
    db.execute(
        "UPDATE board_items SET x=?,y=?,w=?,h=?,text=?,color=?,z=? WHERE id=?",
        (item["x"], item["y"], item["w"], item["h"], item["text"], item["color"], item["z"], item_id),
    )
    db.commit()
    return jsonify(board_item_to_dict(db.execute("SELECT * FROM board_items WHERE id=?", (item_id,)).fetchone()))


@app.delete("/api/board/items/<int:item_id>")
def delete_board_item(item_id):
    db = get_db()
    cur = db.execute("DELETE FROM board_items WHERE id = ?", (item_id,))
    if cur.rowcount == 0: return error("Nie znaleziono elementu.", 404)
    db.execute("DELETE FROM board_links WHERE from_id=? OR to_id=?", (item_id, item_id))
    db.commit()
    return "", 204


@app.post("/api/board/links")
def create_board_link():
    data = json_object()
    from_id, to_id = data.get("from_id"), data.get("to_id")
    for v in (from_id, to_id):
        if not isinstance(v, int) or isinstance(v, bool) or not 1 <= v <= 2**31:
            return error("'from_id' i 'to_id' musza byc dodatnimi liczbami calkowitymi.")
    if from_id == to_id: return error("Nie mozna polaczyc elementu z samym soba.")
    db = get_db()
    if db.execute("SELECT COUNT(*) AS c FROM board_items WHERE id IN (?,?)", (from_id, to_id)).fetchone()["c"] != 2:
        return error("Nie znaleziono elementu.", 404)
    if db.execute("SELECT 1 FROM board_links WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)", (from_id, to_id, to_id, from_id)).fetchone():
        return error("Te elementy sa juz polaczone.")
    cur = db.execute("INSERT INTO board_links (from_id, to_id) VALUES (?, ?)", (from_id, to_id))
    db.commit()
    return jsonify(board_link_to_dict(db.execute("SELECT * FROM board_links WHERE id=?", (cur.lastrowid,)).fetchone())), 201


@app.delete("/api/board/links/<int:link_id>")
def delete_board_link(link_id):
    db = get_db()
    cur = db.execute("DELETE FROM board_links WHERE id = ?", (link_id,))
    db.commit()
    return ("", 204) if cur.rowcount else error("Nie znaleziono polaczenia.", 404)


init_db()
if __name__ == "__main__":
    app.run(debug=True)
