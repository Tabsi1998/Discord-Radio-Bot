import os
import json
from pathlib import Path
from datetime import datetime, timezone
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient

load_dotenv()

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

        required_tier = os.environ.get(f"BOT_{i}_TIER", "free").strip().lower()
        is_premium_bot = required_tier != "free"

        bots.append({
            "botId": f"bot-{i}",
            "index": i,
            "name": name,
            "clientId": cid or f"0000000000000000{i:02d}",
            "inviteUrl": None if is_premium_bot else (f"https://discord.com/oauth2/authorize?client_id={cid}&scope=bot%20applications.commands&permissions=3145728" if cid else ""),
            "requiredTier": required_tier,
            "color": color,
            "avatarUrl": img,
            "servers": 0,
            "users": 0,
            "connections": 0,
            "listeners": 0,
            "ready": False,
            "userTag": None,
            "uptimeSec": 0,
            "guildDetails": [],
        })

    # Wenn keine Bots in .env konfiguriert, Platzhalter-Bots zeigen
    if not bots:
        for i in range(1, 5):
            bots.append({
                "botId": f"bot-{i}",
                "index": i,
                "name": f"Radio Bot {i}",
                "clientId": f"0000000000000000{i:02d}",
                "inviteUrl": "",
                "requiredTier": "free",
                "color": BOT_COLORS[(i - 1) % len(BOT_COLORS)],
                "avatarUrl": BOT_IMAGES[(i - 1) % len(BOT_IMAGES)],
                "servers": 0,
                "users": 0,
                "connections": 0,
                "listeners": 0,
                "ready": False,
                "userTag": None,
                "uptimeSec": 0,
                "guildDetails": [],
            })

    return bots


def seed_stations_if_empty():
    if db.stations.count_documents({}) == 0:
        file_data = load_stations_from_file()
        stations_list = []
        file_stations = file_data.get("stations", {})
        genre_map = {
            "oneworldradio": "Electronic / Festival",
            "tomorrowlandanthems": "Electronic / Festival",
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
            {"name": "/health", "args": "", "description": "Zeigt Stream-Health und Reconnect-Info"},
            {"name": "/premium", "args": "", "description": "Zeigt den Premium-Status dieses Servers"}
        ]
    }


PREMIUM_FILE = Path(__file__).parent.parent / "premium.json"
TIERS = {
    "free":     {"name": "Free",     "bitrate": "128k", "reconnectMs": 3000, "maxBots": 4},
    "pro":      {"name": "Pro",      "bitrate": "192k", "reconnectMs": 1000, "maxBots": 10},
    "ultimate": {"name": "Ultimate", "bitrate": "320k", "reconnectMs": 500,  "maxBots": 20},
}

def load_premium():
    try:
        if PREMIUM_FILE.exists():
            return json.loads(PREMIUM_FILE.read_text())
        return {"licenses": {}}
    except Exception:
        return {"licenses": {}}

def save_premium(data):
    PREMIUM_FILE.write_text(json.dumps(data, indent=2) + "\n")

@app.get("/api/premium/check")
async def check_premium(serverId: str = ""):
    if not serverId or not serverId.isdigit() or len(serverId) < 17:
        return {"error": "serverId muss 17-22 Ziffern sein."}
    data = load_premium()
    license_info = data.get("licenses", {}).get(serverId)
    tier = license_info.get("tier", "free") if license_info else "free"
    tier_config = TIERS.get(tier, TIERS["free"])
    return {"serverId": serverId, "tier": tier, **tier_config, "license": license_info}

@app.get("/api/premium/tiers")
async def get_tiers():
    return {"tiers": TIERS}

@app.get("/api/premium/invite-links")
async def premium_invite_links(serverId: str = ""):
    if not serverId or not serverId.isdigit() or len(serverId) < 17:
        return {"error": "serverId muss 17-22 Ziffern sein."}
    data = load_premium()
    license_info = data.get("licenses", {}).get(serverId)
    tier = license_info.get("tier", "free") if license_info else "free"
    tier_rank = {"free": 0, "pro": 1, "ultimate": 2}
    server_rank = tier_rank.get(tier, 0)

    bots_data = load_bots_from_env()
    links = []
    for bot in bots_data:
        bot_tier = bot.get("requiredTier", "free")
        bot_rank = tier_rank.get(bot_tier, 0)
        has_access = server_rank >= bot_rank
        links.append({
            "botId": bot["botId"],
            "name": bot["name"],
            "requiredTier": bot_tier,
            "hasAccess": has_access,
            "inviteUrl": bot.get("inviteUrl") if has_access and bot_tier == "free" else (f"https://discord.com/oauth2/authorize?client_id={bot['clientId']}&scope=bot%20applications.commands&permissions=3145728" if has_access else None),
        })
    return {"serverId": serverId, "serverTier": tier, "bots": links}


@app.post("/api/premium/checkout")
async def premium_checkout(body: dict):
    tier = body.get("tier", "")
    server_id = body.get("serverId", "")
    return_url = body.get("returnUrl", "")

    if tier not in ("pro", "ultimate"):
        return {"error": "tier muss 'pro' oder 'ultimate' sein."}
    if not server_id or not server_id.isdigit() or len(server_id) < 17:
        return {"error": "serverId muss 17-22 Ziffern sein."}

    stripe_key = os.environ.get("STRIPE_API_KEY", "")
    if not stripe_key:
        return {"error": "Stripe nicht konfiguriert."}

    try:
        import stripe
        stripe.api_key = stripe_key

        price_map = {"pro": 499, "ultimate": 999}
        tier_names = {"pro": "Radio Bot Pro", "ultimate": "Radio Bot Ultimate"}

        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            mode="payment",
            line_items=[{
                "price_data": {
                    "currency": "eur",
                    "product_data": {
                        "name": tier_names[tier],
                        "description": f"Premium {TIERS[tier]['name']} fuer Server {server_id}",
                    },
                    "unit_amount": price_map[tier],
                },
                "quantity": 1,
            }],
            metadata={"serverId": server_id, "tier": tier},
            success_url=(return_url or "http://localhost") + "?payment=success&session_id={CHECKOUT_SESSION_ID}",
            cancel_url=(return_url or "http://localhost") + "?payment=cancelled",
        )
        return {"sessionId": session.id, "url": session.url}
    except Exception as e:
        return {"error": f"Checkout fehlgeschlagen: {str(e)}"}

@app.post("/api/premium/verify")
async def verify_premium(body: dict):
    session_id = body.get("sessionId", "")
    if not session_id:
        return {"error": "sessionId erforderlich."}

    stripe_key = os.environ.get("STRIPE_API_KEY", "")
    if not stripe_key:
        return {"error": "Stripe nicht konfiguriert."}

    try:
        import stripe
        stripe.api_key = stripe_key
        session = stripe.checkout.Session.retrieve(session_id)

        if session.payment_status == "paid":
            metadata = session.metadata or {}
            server_id = metadata.get("serverId", "")
            tier = metadata.get("tier", "")
            if server_id and tier and tier in ("pro", "ultimate"):
                data = load_premium()
                data["licenses"][server_id] = {
                    "tier": tier,
                    "activatedAt": datetime.now(timezone.utc).isoformat(),
                    "activatedBy": "stripe",
                    "note": f"Session: {session_id}"
                }
                save_premium(data)
                return {"success": True, "serverId": server_id, "tier": tier,
                        "message": f"Server {server_id} auf {TIERS[tier]['name']} aktiviert!"}

        return {"success": False, "message": "Zahlung nicht abgeschlossen."}
    except Exception as e:
        return {"error": f"Verifizierung fehlgeschlagen: {str(e)}"}
