import json
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
    created_at  TEXT    NOT NULL DEFAULT (datatime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL 'Nowa notatka',
    content     INTEGER NOT NULL DEFAULT '',
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

@app.get("/api/tasks/categories")
def list_categories():
    """Unikalne kategorie wsrod wszystkich zadan (niepuste)."""
    rows = get_db().execute(
        "SELECT DISTINCT category FROM tasks WHERE category != '' ORDER BY category COLLATE NOCASE"
    ).fetchall()
    return jsonify([r["category"] for r in rows])


def error(message, status=400):
    return jsonify({"error": message}), status


def clean_text(value, max_len):
    """Zwraca przyciety tekst lub None, jesli to nie string."""
    if not isinstance(value, str):
        return None
    return value.strip()[:max_len]

def init_db():
    db= sqlite3.connect(DB_PATH)
    db.executescript(SCHEMA)
    for key, value in DEFAULT_SETTINGS.items():
        db.execute(
            (key, json.dumps(value)),
        )
    db.commit()
    db.close()

def error(message, status=400):
    return jsonify({"error": message}), status

def clean_text(value, max_len) :
    """Zwraca przyciety tekst lub None, jesli to nie string."""
    if not isinstance(value, str):
        return None
    return value.strip() [:max_len]


@app.get("/")
def index():
    return app.send_static_file("index.html")

def task_to_dict(row):
    return {
        "id": row["id"],
        "title": row["title"],
        "priority": row["priority"],
        "done": bool(row["done"]),
        "created_at": row["created_at"],
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
    """Czesciowa aktualizacja: title, priority, done."""
    db = get_db()
    row = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None:
        return error("Nie znaleziono zadania.", 404)

    data = request.get_json(silent=True) or {}
    title = row["title"]
    priority = row["priority"]
    done = row["done"]

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
        "UPDATE tasks SET title = ?, priority = ?, done = ?, category = ?, recur_days = ?, next_due = ? WHERE id = ?",
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
    if cur.rowcount == 0:
        return error("Nie znaleziono zadania.", 404)
    return "", 204

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
    title = row["title"]
    content = row["content"]

    if "title" in data:
        title = clean_text(data["title"], 100) or "Bez tytulu"
    if "content" in data:
        if not isinstance(data["content"], str):
            return error("Pole 'content' musi byc tekstem.")
        content = data["content"][:20000]

    db.execute(
        "UPDATE notes SET title = ?, content = ?, updated_at = datetime('now','localtime') WHERE id = ?",
        (title, content, note_id),
    )
    db.commit()
    row = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    return jsonify(note_to_dict(row))


@app.put("/api/notes/<int:note_id>")
def update_note(note_id):
    db = get_db()
    row = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if row is None:
        return error("Nie znaleziono notatki.", 404)
    data = request.get_json(silent=True) or {}
    title   = clean_text(data["title"], 100) or "Bez tytulu" if "title" in data else row["title"]
    content = row["content"]
    if "content" in data:
        if not isinstance(data["content"], str): return error("Pole 'content' musi byc tekstem.")
        content = data["content"][:20000]
    db.execute(
        "UPDATE notes SET title=?,content=?,updated_at=datetime('now','localtime') WHERE id=?",
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

# Pomodoro API
@app.get("/api/pomodoro")
def pomodoro_stats():
    db = get_db()
    q = db.execute
    return jsonify({
        "today":        q("SELECT COUNT(*) AS c FROM pomodoro_sessions WHERE date(completed_at)=date('now','localtime')").fetchone()["c"],
        "total":        q("SELECT COUNT(*) AS c FROM pomodoro_sessions").fetchone()["c"],
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

    #Api Ustawienia
    
def read_settings():
    rows = get_db().execute("SELECT key, value FROM settings").fetchall()
    settings = dict(DEFAULT_SETTINGS)
    for r in rows:
        settings[r["key"]] = json.loads(r["value"])
    # stara baza mogla zapisac uklad bez nowszych kafelkow - dopisz brakujace na koncu
    layout = [t for t in settings["layout"] if t in TILES]
    for i, tile in enumerate(TILES):
        if tile not in layout:
            # wstaw przed pierwszym z kolejnych kafelkow, ktory juz jest w ukladzie
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



#AI
if __name__ == "__main__":
    app.run(debug=True)
#