import json
import os 
import sqlite3

from flask import Flask, g, jsonify, request # type: ignore

BASE_DIR = os.dirname(os.path.abspath(__file__))
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