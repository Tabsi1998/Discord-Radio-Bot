import os
import json
import string
import secrets
from pathlib import Path
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient

load_dotenv()

app = FastAPI(title="OmniFM API")

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

BOT_IMAGES = ["/img/bot-1.png", "/img/bot-2.png", "/img/bot-3.png", "/img/bot-4.png"]
BOT_COLORS = ["cyan", "green", "pink", "amber", "purple", "red"]

# OmniFM v3 Tier-Konfiguration (identisch mit config/plans.js)
TIERS = {
    "free":     {"name": "Free",     "bitrate": "64k",  "reconnectMs": 5000, "maxBots": 2,  "pricePerMonth": 0},
    "pro":      {"name": "Pro",      "bitrate": "128k", "reconnectMs": 1500, "maxBots": 8,  "pricePerMonth": 299},
    "ultimate": {"name": "Ultimate", "bitrate": "320k", "reconnectMs": 400,  "maxBots": 16, "pricePerMonth": 499},
}

# Seat-basierte Preise (Cents pro Monat)
SEAT_PRICING = {
    "pro":      {1: 299, 2: 549, 3: 749, 5: 1149},
    "ultimate": {1: 499, 2: 799, 3: 1099, 5: 1699},
}

SEAT_OPTIONS = [1, 2, 3, 5]
YEARLY_DISCOUNT_MONTHS = 10  # 12 Monate = nur 10 bezahlen


def get_stripe_secret_key():
    key = (os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY") or "").strip()
    return key


def validate_stripe_key(key):
    """Prueft ob der Stripe Key gueltig aussieht"""
    if not key:
        return False, "Stripe ist nicht konfiguriert. Bitte STRIPE_SECRET_KEY oder STRIPE_API_KEY in der .env setzen."
    if not (key.startswith("sk_test_") or key.startswith("sk_live_")):
        return False, "Stripe API-Key ungueltig. Der Key muss mit 'sk_test_' oder 'sk_live_' beginnen. Bitte den richtigen Secret Key aus dem Stripe Dashboard verwenden."
    if len(key) < 30:
        return False, "Stripe API-Key zu kurz. Bitte den vollstaendigen Key aus dem Stripe Dashboard kopieren."
    return True, ""


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
        name = os.environ.get(f"BOT_{i}_NAME", f"OmniFM Bot {i}").strip()
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
        for i in range(1, 3):
            bots.append({
                "botId": f"bot-{i}", "index": i,
                "name": f"OmniFM Bot {i}",
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


# === Premium Helper Functions ===

def load_premium():
    try:
        if PREMIUM_FILE.exists():
            data = json.loads(PREMIUM_FILE.read_text())
            # Support both old format (licenses keyed by serverId) and new format (licenses + serverEntitlements)
            if "serverEntitlements" in data:
                return data
            return data
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


def get_server_license(server_id):
    """Get license for a server - supports both old and new format"""
    data = load_premium()
    sid = str(server_id)

    # New format: serverEntitlements -> licenseId -> licenses
    if "serverEntitlements" in data:
        ent = data.get("serverEntitlements", {}).get(sid)
        if ent:
            lic = data.get("licenses", {}).get(ent.get("licenseId", ""))
            if lic:
                expired = is_expired(lic)
                return {
                    **lic,
                    "expired": expired,
                    "remainingDays": remaining_days(lic),
                    "activeTier": "free" if expired else lic.get("plan", "free"),
                    "tier": lic.get("plan", "free"),
                }

    # Old format: licenses keyed by serverId
    lic = data.get("licenses", {}).get(sid)
    if not lic:
        return None
    expired = is_expired(lic)
    return {
        **lic,
        "expired": expired,
        "remainingDays": remaining_days(lic),
        "activeTier": "free" if expired else lic.get("tier", lic.get("plan", "free")),
        "tier": lic.get("tier", lic.get("plan", "free")),
    }


def get_tier(server_id):
    lic = get_server_license(server_id)
    if not lic or lic.get("expired"):
        return "free"
    tier = lic.get("tier", lic.get("plan", "free"))
    return tier if tier in TIERS else "free"


def get_license(server_id):
    return get_server_license(server_id)


def get_seat_price(tier, seats):
    pricing = SEAT_PRICING.get(tier, {})
    return pricing.get(seats, pricing.get(1, 0))


def calculate_price(tier, months, seats=1):
    ppm = get_seat_price(tier, seats)
    if not ppm:
        return 0
    if months >= 12:
        full_years = months // 12
        rem = months % 12
        return (full_years * YEARLY_DISCOUNT_MONTHS * ppm) + (rem * ppm)
    return months * ppm


def calculate_upgrade_price(server_id, new_tier):
    lic = get_server_license(server_id)
    if not lic or lic.get("expired"):
        return None
    old_tier = lic.get("tier", "free")
    old_ppm = TIERS.get(old_tier, {}).get("pricePerMonth", 0)
    new_ppm = TIERS.get(new_tier, {}).get("pricePerMonth", 0)
    if new_ppm <= old_ppm:
        return None
    days_left = lic.get("remainingDays", 0)
    if days_left <= 0:
        return None
    diff_daily = (new_ppm - old_ppm) / 30
    upgrade_cost = round(diff_daily * days_left)
    return {
        "oldTier": old_tier,
        "newTier": new_tier,
        "daysLeft": days_left,
        "upgradeCost": upgrade_cost,
    }


def generate_license_key():
    """Generiert einen eindeutigen Lizenz-Key im Format OMNI-XXXX-XXXX-XXXX"""
    chars = string.ascii_uppercase + string.digits
    parts = [''.join(secrets.choice(chars) for _ in range(4)) for _ in range(3)]
    return f"OMNI-{parts[0]}-{parts[1]}-{parts[2]}"


def add_license(email, tier, months, seats=1, activated_by="stripe", note=""):
    if tier not in TIERS or tier == "free":
        raise ValueError("Tier muss 'pro' oder 'ultimate' sein.")
    if months < 1:
        raise ValueError("Mindestens 1 Monat.")
    data = load_premium()
    now = datetime.now(timezone.utc)

    license_key = generate_license_key()
    # Sicherstellen dass der Key eindeutig ist
    while license_key in data.get("licenses", {}):
        license_key = generate_license_key()

    data.setdefault("licenses", {})[license_key] = {
        "tier": tier,
        "plan": tier,
        "seats": seats,
        "email": email,
        "linkedServerIds": [],
        "activatedAt": now.isoformat(),
        "expiresAt": (now + timedelta(days=months * 30)).isoformat(),
        "durationMonths": months,
        "activatedBy": activated_by,
        "note": note,
    }
    save_premium(data)
    return {**data["licenses"][license_key], "licenseKey": license_key}


def upgrade_license(server_id, new_tier):
    data = load_premium()
    sid = str(server_id)
    lic = data.get("licenses", {}).get(sid)
    if not lic or is_expired(lic):
        raise ValueError("Keine aktive Lizenz zum Upgraden.")
    data["licenses"][sid] = {
        **lic,
        "tier": new_tier,
        "plan": new_tier,
        "upgradedAt": datetime.now(timezone.utc).isoformat(),
        "upgradedFrom": lic.get("tier"),
    }
    save_premium(data)
    return data["licenses"][sid]


# === API Routes ===

@app.get("/api/health")
async def health():
    return {"ok": True, "status": "online", "brand": "OmniFM", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/api/bots")
async def get_bots():
    bots = []
    for bot in load_bots_from_env():
        item = dict(bot)
        if item.get("requiredTier", "free") != "free":
            item["clientId"] = None
            item["inviteUrl"] = None
        bots.append(item)
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
    # Sort: free first, then pro, then ultimate
    tier_order = {"free": 0, "pro": 1, "ultimate": 2}
    stations_list.sort(key=lambda s: (tier_order.get(s["tier"], 0), s["name"]))
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
    free_count = sum(1 for s in file_data.get("stations", {}).values() if s.get("tier", "free") == "free")
    pro_count = station_count - free_count
    totals = {"servers": 0, "users": 0, "connections": 0, "listeners": 0, "bots": len(bots), "stations": station_count, "freeStations": free_count, "proStations": pro_count}
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
            {"name": "/play", "args": "[station] [channel]", "description": "Starte einen Radio-Stream im Voice-Channel"},
            {"name": "/pause", "args": "", "description": "Wiedergabe pausieren"},
            {"name": "/resume", "args": "", "description": "Wiedergabe fortsetzen"},
            {"name": "/stop", "args": "", "description": "Stoppen und Channel verlassen"},
            {"name": "/stations", "args": "", "description": "Verfuegbare Stationen fuer deinen Plan anzeigen"},
            {"name": "/list", "args": "[page]", "description": "Stationen auflisten (paginiert)"},
            {"name": "/now", "args": "", "description": "Zeigt was gerade laeuft"},
            {"name": "/setvolume", "args": "<0-100>", "description": "Lautstaerke setzen"},
            {"name": "/status", "args": "", "description": "Bot-Status und Uptime anzeigen"},
            {"name": "/health", "args": "", "description": "Stream-Health und Reconnect-Info anzeigen"},
            {"name": "/premium", "args": "", "description": "OmniFM Premium-Status deines Servers anzeigen"},
            {"name": "/addstation", "args": "<key> <name> <url>", "description": "[Ultimate] Eigene Station-URL hinzufuegen"},
            {"name": "/removestation", "args": "<key>", "description": "[Ultimate] Eigene Station entfernen"},
            {"name": "/mystations", "args": "", "description": "[Ultimate] Deine eigenen Stationen anzeigen"},
            {"name": "/license activate", "args": "<key>", "description": "Lizenz-Key fuer diesen Server aktivieren"},
            {"name": "/license info", "args": "", "description": "Lizenz-Info fuer diesen Server anzeigen"},
            {"name": "/license remove", "args": "", "description": "Diesen Server von der Lizenz entfernen"},
        ]
    }


# === Premium API ===

@app.get("/api/premium/check")
async def check_premium(serverId: str = "", licenseKey: str = ""):
    # Lizenz per Key suchen
    if licenseKey:
        data = load_premium()
        lic = data.get("licenses", {}).get(licenseKey)
        if not lic:
            return {"error": "Lizenz-Key nicht gefunden."}
        expired = is_expired(lic)
        return {
            "licenseKey": licenseKey,
            "tier": lic.get("tier", lic.get("plan", "free")),
            "seats": lic.get("seats", 1),
            "linkedServerIds": lic.get("linkedServerIds", []),
            "email": lic.get("email", ""),
            "expiresAt": lic.get("expiresAt"),
            "expired": expired,
            "remainingDays": remaining_days(lic),
        }

    # Fallback: Server-ID basiert
    if not serverId or not serverId.isdigit() or len(serverId) < 17:
        return {"error": "serverId oder licenseKey erforderlich."}
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
        "brand": "OmniFM",
        "tiers": {
            "free": {
                "name": "Free",
                "pricePerMonth": 0,
                "features": ["64k Bitrate", "Bis zu 2 Bots", "20 Free Stationen", "Standard Reconnect (5s)"]
            },
            "pro": {
                "name": "Pro",
                "pricePerMonth": TIERS["pro"]["pricePerMonth"],
                "startingAt": "2,99",
                "seatPricing": SEAT_PRICING["pro"],
                "features": ["128k Bitrate (HQ Opus)", "Bis zu 8 Bots", "120 Stationen (Free + Pro)", "Priority Reconnect (1,5s)", "Server-Lizenz (1/2/3/5 Server)"]
            },
            "ultimate": {
                "name": "Ultimate",
                "pricePerMonth": TIERS["ultimate"]["pricePerMonth"],
                "startingAt": "4,99",
                "seatPricing": SEAT_PRICING["ultimate"],
                "features": ["320k Bitrate (Ultra HQ)", "Bis zu 16 Bots", "Alle Stationen + Custom URLs", "Instant Reconnect (0,4s)", "Server-Lizenz Bundles"]
            },
        },
        "yearlyDiscount": "12 Monate = 10 bezahlen (2 Monate gratis)",
        "yearlyDiscountMonths": YEARLY_DISCOUNT_MONTHS,
        "seatOptions": SEAT_OPTIONS,
    }
    if serverId and serverId.isdigit() and len(serverId) >= 17:
        license_info = get_license(serverId)
        if license_info and not license_info.get("expired"):
            result["currentLicense"] = {
                "tier": license_info.get("tier", license_info.get("plan", "free")),
                "expiresAt": license_info.get("expiresAt"),
                "remainingDays": license_info.get("remainingDays", 0),
            }
            if license_info.get("tier", "") == "pro":
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
    tier_config = TIERS.get(tier, TIERS["free"])
    tier_rank = {"free": 0, "pro": 1, "ultimate": 2}
    server_rank = tier_rank.get(tier, 0)
    max_bots = int(tier_config.get("maxBots", 0))

    bots_data = load_bots_from_env()
    links = []
    for bot in bots_data:
        bot_index = int(bot.get("index", 0) or 0)
        bot_tier = bot.get("requiredTier", "free")
        bot_rank = tier_rank.get(bot_tier, 0)
        has_tier_access = server_rank >= bot_rank
        within_bot_limit = bot_index > 0 and bot_index <= max_bots
        has_access = has_tier_access and within_bot_limit
        blocked_reason = None if has_access else ("tier" if not has_tier_access else "maxBots")
        invite = None
        if has_access:
            cid = bot.get("clientId", "")
            invite = f"https://discord.com/oauth2/authorize?client_id={cid}&scope=bot%20applications.commands&permissions=3145728" if cid else None
        links.append({
            "botId": bot["botId"],
            "name": bot["name"],
            "index": bot_index,
            "requiredTier": bot_tier,
            "hasAccess": has_access,
            "blockedReason": blocked_reason,
            "inviteUrl": invite,
        })
    return {"serverId": serverId, "serverTier": tier, "serverMaxBots": max_bots, "bots": links}


@app.post("/api/premium/checkout")
async def premium_checkout(body: dict):
    tier = body.get("tier", "")
    email = body.get("email", "").strip()
    months = body.get("months", 1)
    raw_seats = body.get("seats", 1)
    return_url = body.get("returnUrl", "")

    if tier not in ("pro", "ultimate"):
        return {"error": "tier muss 'pro' oder 'ultimate' sein."}
    if not email or "@" not in email:
        return {"error": "Bitte eine gueltige E-Mail-Adresse angeben."}

    seats = int(raw_seats) if int(raw_seats) in SEAT_OPTIONS else 1

    stripe_key = get_stripe_secret_key()
    if not stripe_key:
        return {"error": "Stripe nicht konfiguriert."}

    try:
        import stripe
        stripe.api_key = stripe_key

        duration_months = max(1, int(months))
        price_in_cents = calculate_price(tier, duration_months, seats)
        tier_name = TIERS[tier]["name"]
        seats_label = f" ({seats} Server)" if seats > 1 else ""
        if duration_months >= 12:
            description = f"{tier_name}{seats_label} - {duration_months} Monate (Jahresrabatt: 2 Monate gratis!)"
        else:
            description = f"{tier_name}{seats_label} - {duration_months} Monat{'e' if duration_months > 1 else ''}"

        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            mode="payment",
            customer_email=email,
            line_items=[{
                "price_data": {
                    "currency": "eur",
                    "product_data": {
                        "name": f"OmniFM {tier_name}",
                        "description": description,
                    },
                    "unit_amount": price_in_cents,
                },
                "quantity": 1,
            }],
            metadata={
                "email": email,
                "tier": tier,
                "seats": str(seats),
                "months": str(duration_months),
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

    stripe_key = get_stripe_secret_key()
    if not stripe_key:
        return {"error": "Stripe nicht konfiguriert."}

    try:
        import stripe
        stripe.api_key = stripe_key
        session = stripe.checkout.Session.retrieve(session_id)

        if session.payment_status == "paid":
            metadata = session.metadata or {}
            email = metadata.get("email", "")
            tier = metadata.get("tier", "")
            months_str = metadata.get("months", "1")
            seats_str = metadata.get("seats", "1")
            seats = int(seats_str) if seats_str.isdigit() and int(seats_str) in SEAT_OPTIONS else 1

            if email and tier and tier in ("pro", "ultimate"):
                duration_months = max(1, int(months_str))
                license_data = add_license(email, tier, duration_months, seats, "stripe", f"Session: {session_id}")

                license_key = license_data.get("licenseKey", "")
                tier_name = TIERS[tier]["name"]
                msg = f"Lizenz {license_key} erstellt! {tier_name} fuer {seats} Server, {months_str} Monat{'e' if int(months_str) > 1 else ''}."

                return {
                    "success": True,
                    "licenseKey": license_key,
                    "email": email,
                    "tier": tier,
                    "seats": seats,
                    "expiresAt": license_data.get("expiresAt"),
                    "message": msg,
                }

        return {"success": False, "message": "Zahlung nicht abgeschlossen."}
    except Exception as e:
        return {"error": f"Verifizierung fehlgeschlagen: {str(e)}"}
