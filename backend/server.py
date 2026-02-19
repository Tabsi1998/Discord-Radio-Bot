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


def load_stations_from_file():
    if not STATIONS_FILE.exists():
        return {"defaultStationKey": None, "stations": {}, "qualityPreset": "custom"}
    with open(STATIONS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def seed_bots_if_empty():
    if db.bots.count_documents({}) == 0:
        default_bots = [
            {
                "bot_id": "bot-1",
                "name": "Radio Bot 1",
                "client_id": "000000000000000001",
                "color": "cyan",
                "description": "Dein erster Radio-Bot fuer 24/7 Musik",
                "invite_url": "",
                "avatar_url": "",
                "servers": 0,
                "users": 0,
                "connections": 0,
                "listeners": 0,
                "ready": False,
                "user_tag": None,
                "uptime_sec": 0,
                "created_at": datetime.now(timezone.utc).isoformat()
            },
            {
                "bot_id": "bot-2",
                "name": "Radio Bot 2",
                "client_id": "000000000000000002",
                "color": "green",
                "description": "Zweiter Bot fuer paralleles Streaming",
                "invite_url": "",
                "avatar_url": "",
                "servers": 0,
                "users": 0,
                "connections": 0,
                "listeners": 0,
                "ready": False,
                "user_tag": None,
                "uptime_sec": 0,
                "created_at": datetime.now(timezone.utc).isoformat()
            },
            {
                "bot_id": "bot-3",
                "name": "Radio Bot 3",
                "client_id": "000000000000000003",
                "color": "pink",
                "description": "Dritter Bot fuer noch mehr Channels",
                "invite_url": "",
                "avatar_url": "",
                "servers": 0,
                "users": 0,
                "connections": 0,
                "listeners": 0,
                "ready": False,
                "user_tag": None,
                "uptime_sec": 0,
                "created_at": datetime.now(timezone.utc).isoformat()
            },
            {
                "bot_id": "bot-4",
                "name": "Radio Bot 4",
                "client_id": "000000000000000004",
                "color": "amber",
                "description": "Vierter Bot fuer maximale Abdeckung",
                "invite_url": "",
                "avatar_url": "",
                "servers": 0,
                "users": 0,
                "connections": 0,
                "listeners": 0,
                "ready": False,
                "user_tag": None,
                "uptime_sec": 0,
                "created_at": datetime.now(timezone.utc).isoformat()
            }
        ]
        db.bots.insert_many(default_bots)


def seed_stations_if_empty():
    if db.stations.count_documents({}) == 0:
        file_data = load_stations_from_file()
        stations_list = []
        file_stations = file_data.get("stations", {})
        for key, val in file_stations.items():
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


seed_bots_if_empty()
seed_stations_if_empty()


@app.get("/api/health")
async def health():
    return {"ok": True, "status": "online", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/api/bots")
async def get_bots():
    bots_cursor = db.bots.find({}, {"_id": 0})
    bots = list(bots_cursor)
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
    bot_count = db.bots.count_documents({})
    station_count = db.stations.count_documents({})
    totals = {"servers": 0, "users": 0, "connections": 0, "listeners": 0, "bots": bot_count, "stations": station_count}
    for bot in db.bots.find({}, {"_id": 0, "servers": 1, "users": 1, "connections": 1, "listeners": 1}):
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
