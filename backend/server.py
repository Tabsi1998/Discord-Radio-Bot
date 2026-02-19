import os
import json
from pathlib import Path
from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient

app = FastAPI(title="Discord Radio Bot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME", "radio_bot")

client = MongoClient(MONGO_URL)
db = client[DB_NAME]

STATIONS_FILE = Path(__file__).parent.parent / "stations.json"

# Bot-Bilder (für die Webseite)
BOT_IMAGES = ["/img/bot-1.png", "/img/bot-2.png", "/img/bot-3.png", "/img/bot-4.png"]
BOT_COLORS = ["cyan", "green", "pink", "amber", "purple", "red"]


def load_stations_from_file():
    if not STATIONS_FILE.exists():
        return {"defaultStationKey": None, "stations": {}, "qualityPreset": "custom"}
    with open(STATIONS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def load_bots_from_env():
    """Dynamisch Bots aus der .env laden - beliebig viele (1-20)."""
    bots = []
    for i in range(1, 21):
        name_key = f"BOT_{i}_NAME"
        token_key = f"BOT_{i}_TOKEN"
        client_id_key = f"BOT_{i}_CLIENT_ID"

        token = os.environ.get(token_key, "").strip()
        cid = os.environ.get(client_id_key, "").strip()

        if not token and not cid:
            continue

        name = os.environ.get(name_key, f"Radio Bot {i}").strip()
        color = BOT_COLORS[(i - 1) % len(BOT_COLORS)]
        img = BOT_IMAGES[(i - 1) % len(BOT_IMAGES)] if i <= len(BOT_IMAGES) else ""

        bots.append({
            "bot_id": f"bot-{i}",
            "index": i,
            "name": name,
            "client_id": cid or f"0000000000000000{i:02d}",
            "color": color,
            "avatar_url": img,
            "servers": 0,
            "users": 0,
            "connections": 0,
            "listeners": 0,
            "ready": False,
            "user_tag": None,
            "uptime_sec": 0,
        })

    # Wenn keine Bots in .env konfiguriert, Platzhalter-Bots zeigen
    if not bots:
        for i in range(1, 5):
            bots.append({
                "bot_id": f"bot-{i}",
                "index": i,
                "name": f"Radio Bot {i}",
                "client_id": f"0000000000000000{i:02d}",
                "color": BOT_COLORS[(i - 1) % len(BOT_COLORS)],
                "avatar_url": BOT_IMAGES[(i - 1) % len(BOT_IMAGES)],
                "servers": 0,
                "users": 0,
                "connections": 0,
                "listeners": 0,
                "ready": False,
                "user_tag": None,
                "uptime_sec": 0,
            })

    return bots


def seed_stations_if_empty():
    if db.stations.count_documents({}) == 0:
        file_data = load_stations_from_file()
        stations_list = []
        file_stations = file_data.get("stations", {})
        genre_map = {
            "oneworldradio": "Electronic / Festival",
            "lofi": "Lo-Fi / Chill",
            "classicrock": "Rock / Classic",
            "chillout": "Chill / Ambient",
            "dance": "Dance / EDM",
            "hiphop": "Hip Hop / Rap",
            "techno": "Techno / House",
            "pop": "Pop / Charts",
            "rock": "Rock / Alternative",
            "bass": "Bass / Dubstep",
            "deutschrap": "Deutsch Rap",
        }
        for key, val in file_stations.items():
            stations_list.append({
                "key": key,
                "name": val.get("name", key),
                "url": val.get("url", ""),
                "genre": genre_map.get(key, "Radio"),
                "is_default": key == file_data.get("defaultStationKey"),
                "created_at": datetime.now(timezone.utc).isoformat()
            })

        if stations_list:
            db.stations.insert_many(stations_list)


seed_stations_if_empty()


@app.get("/api/health")
async def health():
    return {"ok": True, "status": "online", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/api/bots")
async def get_bots():
    bots = load_bots_from_env()
    totals = {"servers": 0, "users": 0, "connections": 0, "listeners": 0}
    for bot in bots:
        totals["servers"] += bot.get("servers", 0)
        totals["users"] += bot.get("users", 0)
        totals["connections"] += bot.get("connections", 0)
        totals["listeners"] += bot.get("listeners", 0)
    return {"bots": bots, "totals": totals}


@app.get("/api/stations")
async def get_stations():
    stations_cursor = db.stations.find({}, {"_id": 0})
    stations = list(stations_cursor)
    default_key = None
    for s in stations:
        if s.get("is_default"):
            default_key = s["key"]
            break
    return {
        "defaultStationKey": default_key,
        "total": len(stations),
        "stations": stations
    }


@app.get("/api/stats")
async def get_stats():
    bots = load_bots_from_env()
    station_count = db.stations.count_documents({})
    totals = {"servers": 0, "users": 0, "connections": 0, "listeners": 0, "bots": len(bots), "stations": station_count}
    for bot in bots:
        totals["servers"] += bot.get("servers", 0)
        totals["users"] += bot.get("users", 0)
        totals["connections"] += bot.get("connections", 0)
        totals["listeners"] += bot.get("listeners", 0)
    return totals


@app.get("/api/commands")
async def get_commands():
    return {
        "commands": [
            {"name": "/play", "args": "[station] [channel]", "description": "Startet einen Radio-Stream im Voice-Channel"},
            {"name": "/pause", "args": "", "description": "Pausiert die aktuelle Wiedergabe"},
            {"name": "/resume", "args": "", "description": "Setzt die Wiedergabe fort"},
            {"name": "/stop", "args": "", "description": "Stoppt die Wiedergabe und verlässt den Channel"},
            {"name": "/stations", "args": "", "description": "Zeigt alle verfügbaren Radio-Stationen"},
            {"name": "/list", "args": "[page]", "description": "Listet Stationen paginiert auf"},
            {"name": "/now", "args": "", "description": "Zeigt die aktuelle Station und Metadaten"},
            {"name": "/setvolume", "args": "<0-100>", "description": "Setzt die Lautstärke"},
            {"name": "/status", "args": "", "description": "Zeigt Bot-Status, Uptime und Last"},
            {"name": "/health", "args": "", "description": "Zeigt Stream-Health und Reconnect-Info"}
        ]
    }
