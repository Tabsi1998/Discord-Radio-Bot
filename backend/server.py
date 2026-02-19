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
            stations_list.append({
                "key": key,
                "name": val.get("name", key),
                "url": val.get("url", ""),
                "genre": "Radio",
                "is_default": key == file_data.get("defaultStationKey"),
                "created_at": datetime.now(timezone.utc).isoformat()
            })

        extra_stations = [
            {"key": "lofi", "name": "Lofi Hip Hop Radio", "url": "https://streams.ilovemusic.de/iloveradio17.mp3", "genre": "Lo-Fi / Chill", "is_default": False},
            {"key": "classicrock", "name": "Classic Rock Radio", "url": "https://streams.ilovemusic.de/iloveradio21.mp3", "genre": "Rock / Classic", "is_default": False},
            {"key": "chillout", "name": "Chillout Lounge", "url": "https://streams.ilovemusic.de/iloveradio7.mp3", "genre": "Chill / Ambient", "is_default": False},
            {"key": "dance", "name": "Dance Radio", "url": "https://streams.ilovemusic.de/iloveradio2.mp3", "genre": "Dance / EDM", "is_default": False},
            {"key": "hiphop", "name": "Hip Hop Channel", "url": "https://streams.ilovemusic.de/iloveradio3.mp3", "genre": "Hip Hop / Rap", "is_default": False},
            {"key": "techno", "name": "Techno Bunker", "url": "https://streams.ilovemusic.de/iloveradio12.mp3", "genre": "Techno / House", "is_default": False},
            {"key": "pop", "name": "Pop Hits", "url": "https://streams.ilovemusic.de/iloveradio.mp3", "genre": "Pop / Charts", "is_default": False},
            {"key": "rock", "name": "Rock Nation", "url": "https://streams.ilovemusic.de/iloveradio4.mp3", "genre": "Rock / Alternative", "is_default": False},
            {"key": "bass", "name": "Bass Boost FM", "url": "https://streams.ilovemusic.de/iloveradio16.mp3", "genre": "Bass / Dubstep", "is_default": False},
            {"key": "deutschrap", "name": "Deutsch Rap", "url": "https://streams.ilovemusic.de/iloveradio6.mp3", "genre": "Deutsch Rap", "is_default": False},
        ]

        for s in extra_stations:
            if not any(st["key"] == s["key"] for st in stations_list):
                s["created_at"] = datetime.now(timezone.utc).isoformat()
                stations_list.append(s)

        if stations_list:
            db.stations.insert_many(stations_list)

        # Also update the stations.json file
        updated_data = {"defaultStationKey": file_data.get("defaultStationKey", "oneworldradio"), "stations": {}}
        for s in stations_list:
            updated_data["stations"][s["key"]] = {"name": s["name"], "url": s["url"]}
        with open(STATIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(updated_data, f, indent=2, ensure_ascii=False)


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
