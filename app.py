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
