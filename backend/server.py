import os
import json
from pathlib import Path
from datetime import datetime, timezone, timedelta
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
PREMIUM_FILE = Path(__file__).parent.parent / "premium.json"

# Bot-Bilder (fuer die Webseite)
BOT_IMAGES = ["/img/bot-1.png", "/img/bot-2.png", "/img/bot-3.png", "/img/bot-4.png"]
BOT_COLORS = ["cyan", "green", "pink", "amber", "purple", "red"]

# Tier-Konfiguration (identisch mit premium-store.js)
TIERS = {
    "free":     {"name": "Free",     "bitrate": "128k", "reconnectMs": 3000, "maxBots": 4,  "pricePerMonth": 0},
    "pro":      {"name": "Pro",      "bitrate": "192k", "reconnectMs": 1000, "maxBots": 10, "pricePerMonth": 499},
    "ultimate": {"name": "Ultimate", "bitrate": "320k", "reconnectMs": 500,  "maxBots": 20, "pricePerMonth": 999},
}

YEARLY_DISCOUNT_MONTHS = 10  # 12 Monate = nur 10 bezahlen


def load_stations_from_file():
    if not STATIONS_FILE.exists():
        return {"defaultStationKey": None, "stations": {}, "qualityPreset": "custom"}
    with open(STATIONS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def load_bots_from_env():
    bots = []
    for i in range(1, 21):
        token = os.environ.get(f"BOT_{i}_TOKEN", "").strip()
        cid = os.environ.get(f"BOT_{i}_CLIENT_ID", "").strip()
        if not token and not cid:
            continue
        name = os.environ.get(f"BOT_{i}_NAME", f"Radio Bot {i}").strip()
        color = BOT_COLORS[(i - 1) % len(BOT_COLORS)]
        img = BOT_IMAGES[(i - 1) % len(BOT_IMAGES)] if i <= len(BOT_IMAGES) else ""
        required_tier = os.environ.get(f"BOT_{i}_TIER", "free").strip().lower()
        is_premium_bot = required_tier != "free"

        bots.append({
            "botId": f"bot-{i}",
            "index": i,
            "name": name,
            "clientId": cid or f"0000000000000000{i:02d}",
            "inviteUrl": None if is_premium_bot else (
                f"https://discord.com/oauth2/authorize?client_id={cid}&scope=bot%20applications.commands&permissions=3145728" if cid else ""
            ),
            "requiredTier": required_tier,
            "color": color,
            "avatarUrl": img,
            "servers": 0, "users": 0, "connections": 0, "listeners": 0,
            "ready": False, "userTag": None, "uptimeSec": 0, "guildDetails": [],
        })

    if not bots:
        for i in range(1, 5):
            bots.append({
                "botId": f"bot-{i}", "index": i,
                "name": f"Radio Bot {i}",
                "clientId": f"0000000000000000{i:02d}",
                "inviteUrl": "",
                "requiredTier": "free",
                "color": BOT_COLORS[(i - 1) % len(BOT_COLORS)],
                "avatarUrl": BOT_IMAGES[(i - 1) % len(BOT_IMAGES)],
                "servers": 0, "users": 0, "connections": 0, "listeners": 0,
                "ready": False, "userTag": None, "uptimeSec": 0, "guildDetails": [],
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
                "tier": val.get("tier", "free"),
                "genre": genre_map.get(key, "Radio"),
                "is_default": key == file_data.get("defaultStationKey"),
                "created_at": datetime.now(timezone.utc).isoformat()
            })
        if stations_list:
            db.stations.insert_many(stations_list)


seed_stations_if_empty()


# === Premium Helper Functions (mirror premium-store.js) ===

def load_premium():
    try:
        if PREMIUM_FILE.exists():
            return json.loads(PREMIUM_FILE.read_text())
        return {"licenses": {}}
    except Exception:
        return {"licenses": {}}


def save_premium(data):
    PREMIUM_FILE.write_text(json.dumps(data, indent=2) + "\n")


def is_expired(license_info):
    if not license_info or not license_info.get("expiresAt"):
        return True
    return datetime.fromisoformat(license_info["expiresAt"].replace("Z", "+00:00")) <= datetime.now(timezone.utc)


def remaining_days(license_info):
    if not license_info or not license_info.get("expiresAt"):
        return 0
    diff = datetime.fromisoformat(license_info["expiresAt"].replace("Z", "+00:00")) - datetime.now(timezone.utc)
    return max(0, int(diff.total_seconds() / 86400) + 1)


def get_tier(server_id):
    data = load_premium()
    lic = data.get("licenses", {}).get(str(server_id))
    if not lic:
        return "free"
    if is_expired(lic):
        return "free"
    return lic.get("tier", "free") if lic.get("tier") in TIERS else "free"


def get_license(server_id):
    data = load_premium()
    lic = data.get("licenses", {}).get(str(server_id))
    if not lic:
        return None
    expired = is_expired(lic)
    return {
        **lic,
        "expired": expired,
        "remainingDays": remaining_days(lic),
        "activeTier": "free" if expired else lic.get("tier", "free"),
    }


def calculate_price(tier, months):
    config = TIERS.get(tier)
    if not config or tier == "free":
        return 0
    ppm = config["pricePerMonth"]
    if months >= 12:
        full_years = months // 12
        remaining = months % 12
        return (full_years * YEARLY_DISCOUNT_MONTHS * ppm) + (remaining * ppm)
    return months * ppm


def calculate_upgrade_price(server_id, new_tier):
    data = load_premium()
    lic = data.get("licenses", {}).get(str(server_id))
    if not lic or is_expired(lic):
        return None
    old_tier = lic.get("tier", "free")
    old_config = TIERS.get(old_tier)
    new_config = TIERS.get(new_tier)
    if not old_config or not new_config:
        return None
    if new_config["pricePerMonth"] <= old_config["pricePerMonth"]:
        return None
    days_left = remaining_days(lic)
    if days_left <= 0:
        return None
    old_daily = old_config["pricePerMonth"] / 30
    new_daily = new_config["pricePerMonth"] / 30
    upgrade_cost = round((new_daily - old_daily) * days_left)
    return {
        "oldTier": old_tier,
        "newTier": new_tier,
        "daysLeft": days_left,
        "upgradeCost": upgrade_cost,
        "expiresAt": lic.get("expiresAt"),
    }


def add_license(server_id, tier, months, activated_by="stripe", note=""):
    if tier not in TIERS or tier == "free":
        raise ValueError("Tier muss 'pro' oder 'ultimate' sein.")
    if months < 1:
        raise ValueError("Mindestens 1 Monat.")
    data = load_premium()
    existing = data.get("licenses", {}).get(str(server_id))
    now = datetime.now(timezone.utc)

    if existing and not is_expired(existing) and existing.get("tier") == tier:
        current_expiry = datetime.fromisoformat(existing["expiresAt"].replace("Z", "+00:00"))
        expires_at = current_expiry + timedelta(days=months * 30)
    else:
        expires_at = now + timedelta(days=months * 30)

    data.setdefault("licenses", {})[str(server_id)] = {
        "tier": tier,
        "activatedAt": now.isoformat(),
        "expiresAt": expires_at.isoformat(),
        "durationMonths": months,
        "activatedBy": activated_by,
        "note": note,
    }
    save_premium(data)
    return data["licenses"][str(server_id)]


def upgrade_license(server_id, new_tier):
    data = load_premium()
    lic = data.get("licenses", {}).get(str(server_id))
    if not lic or is_expired(lic):
        raise ValueError("Keine aktive Lizenz zum Upgraden.")
    if new_tier not in TIERS or new_tier == "free":
        raise ValueError("Ungueltiges Tier.")
    data["licenses"][str(server_id)] = {
        **lic,
        "tier": new_tier,
        "upgradedAt": datetime.now(timezone.utc).isoformat(),
        "upgradedFrom": lic.get("tier"),
    }
    save_premium(data)
    return data["licenses"][str(server_id)]


# === API Routes ===

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
    file_data = load_stations_from_file()
    file_stations = file_data.get("stations", {})
    stations_list = []
    for key, val in file_stations.items():
        stations_list.append({
            "key": key,
            "name": val.get("name", key),
            "url": val.get("url", ""),
            "tier": val.get("tier", "free"),
        })
    return {
        "defaultStationKey": file_data.get("defaultStationKey"),
        "total": len(stations_list),
        "stations": stations_list
    }


@app.get("/api/stats")
async def get_stats():
    bots = load_bots_from_env()
    file_data = load_stations_from_file()
    station_count = len(file_data.get("stations", {}))
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
            {"name": "/stop", "args": "", "description": "Stoppt die Wiedergabe und verlaesst den Channel"},
            {"name": "/stations", "args": "", "description": "Zeigt alle verfuegbaren Radio-Stationen (nach Tier gefiltert)"},
            {"name": "/list", "args": "[page]", "description": "Listet Stationen paginiert auf"},
            {"name": "/now", "args": "", "description": "Zeigt die aktuelle Station und Metadaten"},
            {"name": "/setvolume", "args": "<0-100>", "description": "Setzt die Lautstaerke"},
            {"name": "/status", "args": "", "description": "Zeigt Bot-Status, Uptime und Last"},
            {"name": "/health", "args": "", "description": "Zeigt Stream-Health und Reconnect-Info"},
            {"name": "/premium", "args": "", "description": "Zeigt den Premium-Status dieses Servers"},
            {"name": "/addstation", "args": "<key> <name> <url>", "description": "[Ultimate] Eigene Station hinzufuegen"},
            {"name": "/removestation", "args": "<key>", "description": "[Ultimate] Eigene Station entfernen"},
            {"name": "/mystations", "args": "", "description": "[Ultimate] Zeigt deine Custom Stationen"},
        ]
    }


# === Premium API ===

@app.get("/api/premium/check")
async def check_premium(serverId: str = ""):
    if not serverId or not serverId.isdigit() or len(serverId) < 17:
        return {"error": "serverId muss 17-22 Ziffern sein."}
    tier = get_tier(serverId)
    tier_config = TIERS.get(tier, TIERS["free"])
    license_info = get_license(serverId)
    return {"serverId": serverId, "tier": tier, **tier_config, "license": license_info}


@app.get("/api/premium/tiers")
async def get_tiers():
    return {"tiers": TIERS}


@app.get("/api/premium/pricing")
async def get_pricing(serverId: str = ""):
    result = {
        "tiers": {
            "pro": {"name": "Pro", "pricePerMonth": TIERS["pro"]["pricePerMonth"],
                     "features": ["192k Bitrate", "10 Bots", "1s Reconnect", "Pro Stationen"]},
            "ultimate": {"name": "Ultimate", "pricePerMonth": TIERS["ultimate"]["pricePerMonth"],
                          "features": ["320k Bitrate", "20 Bots", "0.5s Reconnect", "Alle Stationen", "Eigene Station-URLs"]},
        },
        "yearlyDiscount": "12 Monate = 10 bezahlen (2 Monate gratis)",
        "yearlyDiscountMonths": YEARLY_DISCOUNT_MONTHS,
    }
    if serverId and serverId.isdigit() and len(serverId) >= 17:
        license_info = get_license(serverId)
        if license_info and not license_info.get("expired"):
            result["currentLicense"] = {
                "tier": license_info["tier"],
                "expiresAt": license_info.get("expiresAt"),
                "remainingDays": license_info.get("remainingDays", 0),
            }
            if license_info["tier"] == "pro":
                upgrade = calculate_upgrade_price(serverId, "ultimate")
                if upgrade:
                    result["upgrade"] = {
                        "to": "ultimate",
                        "cost": upgrade["upgradeCost"],
                        "daysLeft": upgrade["daysLeft"],
                    }
    return result


@app.get("/api/premium/invite-links")
async def premium_invite_links(serverId: str = ""):
    if not serverId or not serverId.isdigit() or len(serverId) < 17:
        return {"error": "serverId muss 17-22 Ziffern sein."}
    tier = get_tier(serverId)
    tier_rank = {"free": 0, "pro": 1, "ultimate": 2}
    server_rank = tier_rank.get(tier, 0)

    bots_data = load_bots_from_env()
    links = []
    for bot in bots_data:
        bot_tier = bot.get("requiredTier", "free")
        bot_rank = tier_rank.get(bot_tier, 0)
        has_access = server_rank >= bot_rank
        invite = None
        if has_access:
            cid = bot.get("clientId", "")
            invite = f"https://discord.com/oauth2/authorize?client_id={cid}&scope=bot%20applications.commands&permissions=3145728" if cid else None
        links.append({
            "botId": bot["botId"],
            "name": bot["name"],
            "requiredTier": bot_tier,
            "hasAccess": has_access,
            "inviteUrl": invite,
        })
    return {"serverId": serverId, "serverTier": tier, "bots": links}


@app.post("/api/premium/checkout")
async def premium_checkout(body: dict):
    tier = body.get("tier", "")
    server_id = body.get("serverId", "")
    months = body.get("months", 1)
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

        upgrade_info = calculate_upgrade_price(server_id, tier)

        if upgrade_info and upgrade_info["upgradeCost"] > 0:
            price_in_cents = upgrade_info["upgradeCost"]
            duration_months = 0
            description = f"Upgrade {TIERS[upgrade_info['oldTier']]['name']} -> {TIERS[tier]['name']} ({upgrade_info['daysLeft']} Tage Restlaufzeit)"
        else:
            duration_months = max(1, int(months))
            price_in_cents = calculate_price(tier, duration_months)
            tier_name = TIERS[tier]["name"]
            if duration_months >= 12:
                description = f"{tier_name} - {duration_months} Monate (Jahresrabatt: 2 Monate gratis!)"
            else:
                description = f"{tier_name} - {duration_months} Monat{'e' if duration_months > 1 else ''}"

        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            mode="payment",
            line_items=[{
                "price_data": {
                    "currency": "eur",
                    "product_data": {
                        "name": f"Radio Bot {TIERS[tier]['name']}",
                        "description": description,
                    },
                    "unit_amount": price_in_cents,
                },
                "quantity": 1,
            }],
            metadata={
                "serverId": server_id,
                "tier": tier,
                "months": str(duration_months),
                "isUpgrade": "true" if upgrade_info else "false",
            },
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
            months_str = metadata.get("months", "1")
            is_upgrade = metadata.get("isUpgrade", "false")

            if server_id and tier and tier in ("pro", "ultimate"):
                if is_upgrade == "true":
                    license_data = upgrade_license(server_id, tier)
                else:
                    duration_months = max(1, int(months_str))
                    license_data = add_license(server_id, tier, duration_months, "stripe", f"Session: {session_id}")

                lic_info = get_license(server_id)
                msg = (f"Server {server_id} auf {TIERS[tier]['name']} upgraded!"
                       if is_upgrade == "true"
                       else f"Server {server_id} auf {TIERS[tier]['name']} aktiviert ({months_str} Monat{'e' if int(months_str) > 1 else ''})!")

                return {
                    "success": True,
                    "serverId": server_id,
                    "tier": tier,
                    "expiresAt": license_data.get("expiresAt"),
                    "remainingDays": lic_info["remainingDays"] if lic_info else 0,
                    "message": msg,
                }

        return {"success": False, "message": "Zahlung nicht abgeschlossen."}
    except Exception as e:
        return {"error": f"Verifizierung fehlgeschlagen: {str(e)}"}
