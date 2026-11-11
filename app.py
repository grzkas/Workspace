import json
import os 
import sqlite3

from flask import Flask, g, jsonify, request # type: ignore

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "dashboard.db")

app = Flask(__name__, static_folder="static", static_url_path="/static")

Priorites = ("low", "medium", "high")
Themes = ("light", "dark", "ocean", "forest")
Tiles = ("tasks", "nostes", "pomordo")

Default_Settings = {
    "theme": "light",
    "layout": list(Tiles), 
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
    db= sqlite3.connect(DB_PATH)
    db.executescript(SCHEMA)
    for key, value in DEFAULT_SETTINGS.items():
        db.execute(
            (key, json.dumps(value)),
        )
    db.commit()
    db.close()

def error(message, statues=400):
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
    }


@app.get("/api/tasks")
def list_tasks():
    """Lista zadan. Opcjonalnie ?status=active|done."""
    status = request.args.get("status")
    query = "SELECT * FROM tasks"
    if status == "active":
        query += " WHERE done = 0"
    elif status == "done":
        query += " WHERE done = 1"
    # niewykonane na gorze, potem wg priorytetu (high -> low), potem najnowsze
    query += (
        " ORDER BY done ASC,"
        " CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,"
        " id DESC"
    )
    rows = get_db().execute(query).fetchall()
    return jsonify([task_to_dict(r) for r in rows])


@app.post("/api/tasks")
def create_task():
    data = request.get_json(silent=True) or {}
    title = clean_text(data.get("title"), 200)
    priority = data.get("priority", "medium")
    if not title:
        return error("Pole 'title' jest wymagane.")
    if priority not in PRIORITIES:
        return error("Priorytet musi byc jednym z: low, medium, high.")

    db = get_db()
    cur = db.execute(
        "INSERT INTO tasks (title, priority) VALUES (?, ?)", (title, priority)
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

    db.execute(
        "UPDATE tasks SET title = ?, priority = ?, done = ? WHERE id = ?",
        (title, priority, done, task_id),
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


#AI
if __name__ == "__main__":
    app.run(debug=True)
#