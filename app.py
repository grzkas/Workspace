import json
import os 
import sqlite3

from flask import Flask, g, jsonify, request # type: ignore

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "dashboard.db")

app = Flask(__name__, static_folder="static", static_url_path="/static")

@app.get("/")
def index():
    return app.send_static_file("index.html")

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