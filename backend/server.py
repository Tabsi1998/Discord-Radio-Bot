import os
import json
import re
import hmac
import time
import string
import secrets
import requests
from pathlib import Path
from urllib.parse import urlparse, urlencode
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pymongo import MongoClient

load_dotenv()

app = FastAPI(title="OmniFM API")

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")

STATIONS_FILE = Path(__file__).parent.parent / "stations.json"
PREMIUM_FILE = Path(__file__).parent.parent / "premium.json"
DASHBOARD_FILE = Path(__file__).parent.parent / "dashboard.json"

BOT_IMAGES = ["/img/bot-1.png", "/img/bot-2.png", "/img/bot-3.png", "/img/bot-4.png"]
BOT_COLORS = ["cyan", "green", "pink", "amber", "purple", "red"]

EMAIL_REGEX = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
SERVER_ID_REGEX = re.compile(r"^\d{17,22}$")

DISCORD_CLIENT_ID = (os.environ.get("DISCORD_CLIENT_ID") or "").strip()
DISCORD_CLIENT_SECRET = (os.environ.get("DISCORD_CLIENT_SECRET") or "").strip()
DISCORD_REDIRECT_URI = (os.environ.get("DISCORD_REDIRECT_URI") or "").strip()
DISCORD_OAUTH_SCOPES = (os.environ.get("DISCORD_OAUTH_SCOPES") or "identify guilds").strip()
SESSION_COOKIE_NAME = (os.environ.get("DASHBOARD_SESSION_COOKIE") or "omnifm_session").strip() or "omnifm_session"
try:
    DASHBOARD_SESSION_TTL_SECONDS = max(300, int((os.environ.get("DASHBOARD_SESSION_TTL_SECONDS") or "86400").strip() or "86400"))
except Exception:
    DASHBOARD_SESSION_TTL_SECONDS = 86400
try:
    DISCORD_OAUTH_STATE_TTL_SECONDS = max(60, int((os.environ.get("DISCORD_OAUTH_STATE_TTL_SECONDS") or "600").strip() or "600"))
except Exception:
    DISCORD_OAUTH_STATE_TTL_SECONDS = 600
TIER_RANK = {"free": 0, "pro": 1, "ultimate": 2}

DASHBOARD_SESSION_STORE = {}
DISCORD_OAUTH_STATE_STORE = {}


def build_allowed_origins():
    configured = (os.environ.get("CORS_ALLOWED_ORIGINS") or os.environ.get("CORS_ORIGINS") or "").strip()
    if configured:
        origins = [item.strip() for item in configured.split(",") if item.strip()]
    else:
        origins = []

    if any(item == "*" for item in origins):
        return ["*"]

    public_web_url = (os.environ.get("PUBLIC_WEB_URL") or "").strip()
    if public_web_url:
        origins.append(public_web_url)

    origins.extend(["http://localhost", "http://127.0.0.1", "http://localhost:3000", "http://127.0.0.1:3000"])

    normalized = []
    seen = set()
    for origin in origins:
        parsed = urlparse(origin)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            continue
        clean = f"{parsed.scheme}://{parsed.netloc}"
        if clean in seen:
            continue
        seen.add(clean)
        normalized.append(clean)

    if not normalized:
        return ["http://localhost", "http://127.0.0.1", "http://localhost:3000", "http://127.0.0.1:3000"]
    return normalized


ALLOWED_ORIGINS = build_allowed_origins()
CORS_HAS_WILDCARD = "*" in ALLOWED_ORIGINS

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if CORS_HAS_WILDCARD else ALLOWED_ORIGINS,
    allow_credentials=not CORS_HAS_WILDCARD,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Admin-Token"],
)

client = None
db = None
if MONGO_URL:
    try:
        client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=2000)
        db = client[DB_NAME]
        client.admin.command("ping")
    except Exception:
        client = None
        db = None

# OmniFM v3 Tier-Konfiguration (identisch mit config/plans.js)
TIERS = {
    "free":     {"name": "Free",     "bitrate": "64k",  "reconnectMs": 5000, "maxBots": 2,  "pricePerMonth": 0},
    "pro":      {"name": "Pro",      "bitrate": "128k", "reconnectMs": 1500, "maxBots": 8,  "pricePerMonth": 299},
    "ultimate": {"name": "Ultimate", "bitrate": "320k", "reconnectMs": 400,  "maxBots": 16, "pricePerMonth": 499},
}

# Laufzeit-basierte Preise (Cents pro Monat)
DURATION_PRICING = {
    "pro":      {1: 299, 3: 249, 6: 229, 12: 199},
    "ultimate": {1: 499, 3: 399, 6: 349, 12: 299},
}
DURATION_OPTIONS = [1, 3, 6, 12]

# Server-Anzahl Preise (Multiplikator auf Monats-Basispreis)
SEAT_OPTIONS = [1, 2, 3, 5]
SEAT_MONTHLY_TOTAL_CENTS = {
    "pro":      {1: 299, 2: 549, 3: 749, 5: 1149},
    "ultimate": {1: 499, 2: 799, 3: 1099, 5: 1699},
}
PRO_TRIAL_MONTHS = 1
PRO_TRIAL_SEATS = 1
ADMIN_API_TOKEN = (os.environ.get("API_ADMIN_TOKEN") or os.environ.get("ADMIN_API_TOKEN") or "").strip()
TRUST_PROXY_HEADERS = (os.environ.get("TRUST_PROXY_HEADERS") or "0").strip() == "1"
API_RATE_LIMIT_STATE = {}
try:
    MAX_API_RATE_STATE_ENTRIES = max(1000, int((os.environ.get("API_RATE_STATE_MAX_ENTRIES") or "50000").strip() or "50000"))
except Exception:
    MAX_API_RATE_STATE_ENTRIES = 50000


def json_error(status_code, message):
    return JSONResponse(status_code=status_code, content={"error": message})


def parse_int(value, default):
    try:
        parsed = int(str(value).strip())
        return parsed
    except Exception:
        return default


def is_valid_email(email):
    return bool(EMAIL_REGEX.match(str(email or "").strip()))


def is_valid_server_id(server_id):
    return bool(SERVER_ID_REGEX.match(str(server_id or "").strip()))


def normalize_months(value, default=1):
    try:
        parsed = int(str(value).strip())
    except Exception:
        parsed = default
    return max(1, parsed)


def normalize_duration(value, default=1):
    try:
        parsed = int(str(value).strip())
    except Exception:
        parsed = default
    closest = min(DURATION_OPTIONS, key=lambda x: abs(x - parsed))
    return closest


def mask_email(email):
    raw = str(email or "").strip()
    if "@" not in raw:
        return raw
    local, domain = raw.split("@", 1)
    if len(local) <= 2:
        return "*" * len(local) + "@" + domain
    return local[:2] + "***@" + domain


def clip_text(value, max_len=300):
    text = str(value or "").strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


def extract_mailbox(raw_value):
    text = str(raw_value or "").strip()
    if not text:
        return ""
    bracket_match = re.search(r"<([^>]+)>", text)
    if bracket_match and bracket_match.group(1):
        return bracket_match.group(1).strip()
    plain_match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", text, re.IGNORECASE)
    return plain_match.group(0) if plain_match else ""


def normalize_language(language, fallback="de"):
    value = str(language or "").strip().lower()
    if value.startswith("de"):
        return "de"
    if value.startswith("en"):
        return "en"
    fb = str(fallback or "de").strip().lower()
    return "en" if fb.startswith("en") else "de"


def resolve_language_from_accept_language(accept_language, fallback="de"):
    raw = str(accept_language or "").strip()
    if not raw:
        return normalize_language(None, fallback)
    for part in raw.split(","):
        token = part.split(";")[0].strip()
        if token:
            return normalize_language(token, fallback)
    return normalize_language(None, fallback)


def is_pro_trial_enabled():
    return (os.environ.get("PRO_TRIAL_ENABLED") or "1").strip() != "0"


def sanitize_offer_code(raw_code):
    return re.sub(r"[^A-Z0-9_-]", "", str(raw_code or "").strip().upper())[:50]


def build_public_legal_notice():
    public_url = (os.environ.get("PUBLIC_WEB_URL") or "").strip()
    fallback_email = extract_mailbox(os.environ.get("SMTP_FROM") or "")
    legal = {
        "providerName": (os.environ.get("LEGAL_PROVIDER_NAME") or "").strip(),
        "legalForm": (os.environ.get("LEGAL_LEGAL_FORM") or "").strip(),
        "representative": (os.environ.get("LEGAL_REPRESENTATIVE") or "").strip(),
        "streetAddress": (os.environ.get("LEGAL_STREET_ADDRESS") or "").strip(),
        "postalCode": (os.environ.get("LEGAL_POSTAL_CODE") or "").strip(),
        "city": (os.environ.get("LEGAL_CITY") or "").strip(),
        "country": (os.environ.get("LEGAL_COUNTRY") or "").strip(),
        "email": (os.environ.get("LEGAL_EMAIL") or "").strip() or fallback_email,
        "phone": (os.environ.get("LEGAL_PHONE") or "").strip(),
        "website": (os.environ.get("LEGAL_WEBSITE") or "").strip() or public_url,
        "businessPurpose": (os.environ.get("LEGAL_BUSINESS_PURPOSE") or "").strip(),
        "commercialRegisterNumber": (os.environ.get("LEGAL_COMMERCIAL_REGISTER_NUMBER") or "").strip(),
        "commercialRegisterCourt": (os.environ.get("LEGAL_COMMERCIAL_REGISTER_COURT") or "").strip(),
        "vatId": (os.environ.get("LEGAL_VAT_ID") or "").strip(),
        "supervisoryAuthority": (os.environ.get("LEGAL_SUPERVISORY_AUTHORITY") or "").strip(),
        "chamber": (os.environ.get("LEGAL_CHAMBER") or "").strip(),
        "profession": (os.environ.get("LEGAL_PROFESSION") or "").strip(),
        "professionRules": (os.environ.get("LEGAL_PROFESSION_RULES") or "").strip(),
        "editorialResponsible": (os.environ.get("LEGAL_EDITORIAL_RESPONSIBLE") or "").strip(),
        "mediaOwner": (os.environ.get("LEGAL_MEDIA_OWNER") or "").strip(),
        "mediaLine": (os.environ.get("LEGAL_MEDIA_LINE") or "").strip(),
    }

    missing_core_fields = []
    if not legal["providerName"]:
        missing_core_fields.append("providerName")
    if not legal["streetAddress"]:
        missing_core_fields.append("streetAddress")
    if not legal["postalCode"]:
        missing_core_fields.append("postalCode")
    if not legal["city"]:
        missing_core_fields.append("city")
    if not legal["email"]:
        missing_core_fields.append("email")

    return {
        "legal": legal,
        "missingCoreFields": missing_core_fields,
        "isConfigured": len(missing_core_fields) == 0,
        "basis": ["ECG_5", "UGB_14", "GewO_63", "MedienG_25"],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def build_public_privacy_notice():
    legal_notice = build_public_legal_notice()
    legal = legal_notice.get("legal", {})
    has_stripe = bool(get_stripe_secret_key())
    has_smtp = bool((os.environ.get("SMTP_HOST") or "").strip())
    bot_id_candidate = (os.environ.get("DISCORDBOTLIST_BOT_ID") or os.environ.get("BOT_1_CLIENT_ID") or "").strip()
    has_discordbotlist = (os.environ.get("DISCORDBOTLIST_ENABLED") or "1").strip() != "0" and bool((os.environ.get("DISCORDBOTLIST_TOKEN") or "").strip()) and bool(re.match(r"^\d{17,22}$", bot_id_candidate))
    has_recognition = (os.environ.get("NOW_PLAYING_RECOGNITION_ENABLED") or "0").strip() == "1" and bool((os.environ.get("ACOUSTID_API_KEY") or "").strip())

    controller = {
        "name": (os.environ.get("PRIVACY_CONTROLLER_NAME") or "").strip() or legal.get("providerName", ""),
        "representative": (os.environ.get("PRIVACY_CONTROLLER_REPRESENTATIVE") or "").strip() or legal.get("representative", ""),
        "streetAddress": (os.environ.get("PRIVACY_CONTROLLER_STREET_ADDRESS") or "").strip() or legal.get("streetAddress", ""),
        "postalCode": (os.environ.get("PRIVACY_CONTROLLER_POSTAL_CODE") or "").strip() or legal.get("postalCode", ""),
        "city": (os.environ.get("PRIVACY_CONTROLLER_CITY") or "").strip() or legal.get("city", ""),
        "country": (os.environ.get("PRIVACY_CONTROLLER_COUNTRY") or "").strip() or legal.get("country", "") or "Österreich",
        "website": (os.environ.get("PRIVACY_CONTROLLER_WEBSITE") or "").strip() or legal.get("website", ""),
    }
    contact = {
        "email": (os.environ.get("PRIVACY_CONTACT_EMAIL") or "").strip() or legal.get("email", ""),
        "phone": (os.environ.get("PRIVACY_CONTACT_PHONE") or "").strip() or legal.get("phone", ""),
    }
    dpo = {
        "name": (os.environ.get("PRIVACY_DPO_NAME") or "").strip(),
        "email": (os.environ.get("PRIVACY_DPO_EMAIL") or "").strip(),
    }
    hosting = {
        "provider": (os.environ.get("PRIVACY_HOSTING_PROVIDER") or "").strip(),
        "location": (os.environ.get("PRIVACY_HOSTING_LOCATION") or "").strip(),
    }
    authority = {
        "name": (os.environ.get("PRIVACY_AUTHORITY_NAME") or "").strip() or "Österreichische Datenschutzbehörde",
        "website": (os.environ.get("PRIVACY_AUTHORITY_WEBSITE") or "").strip() or "https://www.dsb.gv.at/",
    }

    missing_core_fields = []
    if not controller["name"]:
        missing_core_fields.append("controllerName")
    if not controller["streetAddress"]:
        missing_core_fields.append("controllerStreetAddress")
    if not controller["postalCode"]:
        missing_core_fields.append("controllerPostalCode")
    if not controller["city"]:
        missing_core_fields.append("controllerCity")
    if not contact["email"]:
        missing_core_fields.append("contactEmail")

    return {
        "controller": controller,
        "contact": contact,
        "dpo": dpo,
        "hosting": hosting,
        "authority": authority,
        "additionalRecipients": (os.environ.get("PRIVACY_ADDITIONAL_RECIPIENTS") or "").strip(),
        "customNote": (os.environ.get("PRIVACY_CUSTOM_NOTE") or "").strip(),
        "features": {
            "stripeEnabled": has_stripe,
            "smtpEnabled": has_smtp,
            "discordBotListEnabled": has_discordbotlist,
            "recognitionEnabled": has_recognition,
            "stationPreviewEnabled": True,
            "localeStorageKey": "omnifm.web.locale",
        },
        "retention": {
            "logDays": parse_int(os.environ.get("LOG_MAX_DAYS"), 14),
            "songHistoryEnabled": (os.environ.get("SONG_HISTORY_ENABLED") or "1").strip() != "0",
            "songHistoryMaxPerGuild": parse_int(os.environ.get("SONG_HISTORY_MAX_PER_GUILD"), 100),
            "listeningStatsEnabled": True,
            "scheduledEventsEnabled": True,
        },
        "missingCoreFields": missing_core_fields,
        "isConfigured": len(missing_core_fields) == 0,
        "basis": ["GDPR_ART_13", "GDPR_ART_15_22", "DSB_AT"],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def first_header_value(raw_value):
    value = str(raw_value or "").strip()
    if not value:
        return ""
    first = value.split(",")[0].strip()
    return first


def get_client_ip(request: Request):
    if TRUST_PROXY_HEADERS:
        forwarded = first_header_value(request.headers.get("x-forwarded-for"))
        if forwarded:
            return forwarded
        real_ip = first_header_value(request.headers.get("x-real-ip"))
        if real_ip:
            return real_ip
    client_host = getattr(request.client, "host", None)
    return str(client_host or "unknown")


def get_api_rate_limit_spec(scope):
    normalized_scope = str(scope or "read").strip().lower()
    if normalized_scope == "write":
        window_ms = parse_int(os.environ.get("API_RATE_WRITE_WINDOW_MS"), 60000)
        max_requests = parse_int(os.environ.get("API_RATE_WRITE_MAX"), 20)
    else:
        window_ms = parse_int(os.environ.get("API_RATE_READ_WINDOW_MS"), 60000)
        max_requests = parse_int(os.environ.get("API_RATE_READ_MAX"), 120)

    return {
        "scope": "write" if normalized_scope == "write" else "read",
        "window_ms": max(1000, window_ms),
        "max_requests": max(1, max_requests),
    }


def cleanup_api_rate_limit_state(now_ms=None):
    now = int(now_ms if now_ms is not None else (time.time() * 1000))
    if len(API_RATE_LIMIT_STATE) < 10000 and len(API_RATE_LIMIT_STATE) <= MAX_API_RATE_STATE_ENTRIES:
        return

    expired_keys = [key for key, value in API_RATE_LIMIT_STATE.items() if not value or int(value.get("reset_at", 0)) <= now]
    for key in expired_keys:
        API_RATE_LIMIT_STATE.pop(key, None)

    if len(API_RATE_LIMIT_STATE) > MAX_API_RATE_STATE_ENTRIES:
        sorted_entries = sorted(API_RATE_LIMIT_STATE.items(), key=lambda entry: int(entry[1].get("reset_at", 0)))
        remove_count = len(API_RATE_LIMIT_STATE) - MAX_API_RATE_STATE_ENTRIES
        for key, _ in sorted_entries[:remove_count]:
            API_RATE_LIMIT_STATE.pop(key, None)


def enforce_api_rate_limit(request: Request, scope):
    spec = get_api_rate_limit_spec(scope)
    now = int(time.time() * 1000)
    cleanup_api_rate_limit_state(now)

    ip = get_client_ip(request)
    key = f"{spec['scope']}:{request.method}:{request.url.path}:{ip}"
    entry = API_RATE_LIMIT_STATE.get(key)
    if not entry or int(entry.get("reset_at", 0)) <= now:
        entry = {"count": 0, "reset_at": now + spec["window_ms"]}

    entry["count"] = int(entry.get("count", 0)) + 1
    API_RATE_LIMIT_STATE[key] = entry

    if entry["count"] > spec["max_requests"]:
        retry_after_seconds = max(1, int((entry["reset_at"] - now + 999) // 1000))
        return JSONResponse(
            status_code=429,
            content={"error": "Rate limit erreicht. Bitte spaeter erneut versuchen.", "retryAfterSeconds": retry_after_seconds},
            headers={"Retry-After": str(retry_after_seconds)},
        )

    return None


def is_admin_request(request: Request):
    if not ADMIN_API_TOKEN:
        return False
    header_token = (request.headers.get("x-admin-token") or "").strip()
    if header_token and hmac.compare_digest(header_token, ADMIN_API_TOKEN):
        return True
    auth = (request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        bearer = auth[7:].strip()
        if bearer and hmac.compare_digest(bearer, ADMIN_API_TOKEN):
            return True
    return False


def parse_origin(raw_url):
    parsed = urlparse(str(raw_url or "").strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def build_allowed_return_origins():
    configured = (os.environ.get("CHECKOUT_RETURN_ORIGINS") or "").strip()
    origins = [item.strip() for item in configured.split(",") if item.strip()] if configured else []
    public_web_url = (os.environ.get("PUBLIC_WEB_URL") or "").strip()
    if public_web_url:
        origins.append(public_web_url)
    origins.extend(["http://localhost", "http://127.0.0.1"])

    allowed = set()
    for origin in origins:
        normalized = parse_origin(origin)
        if normalized:
            allowed.add(normalized)
    return allowed


def resolve_checkout_return_base(return_url):
    fallback = parse_origin((os.environ.get("PUBLIC_WEB_URL") or "").strip()) or "http://localhost"
    if not return_url:
        return fallback

    parsed = urlparse(str(return_url).strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return fallback

    origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin not in build_allowed_return_origins():
        return fallback

    safe_path = parsed.path if parsed.path and parsed.path != "/" else ""
    return f"{origin}{safe_path}"


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
    fallback = {"defaultStationKey": None, "stations": {}, "qualityPreset": "custom"}
    if not STATIONS_FILE.exists():
        return fallback
    try:
        with open(STATIONS_FILE, "r", encoding="utf-8") as f:
            raw = f.read().strip()
            if not raw:
                return fallback
            data = json.loads(raw)
            if not isinstance(data, dict):
                return fallback
            return data
    except Exception:
        return fallback


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
                f"https://discord.com/oauth2/authorize?client_id={cid}&permissions=35186522836032&integration_type=0&scope=bot%20applications.commands" if cid else ""
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
    if db is None:
        return
    try:
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
    except Exception:
        # Mongo is optional for this API process.
        return


seed_stations_if_empty()

# Seed premium data to MongoDB
def seed_premium_if_needed():
    if db is None:
        return
    try:
        if db.licenses.count_documents({}) == 0 and PREMIUM_FILE.exists():
            data = json.loads(PREMIUM_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                licenses = data.get("licenses", {})
                for lic_id, lic in licenses.items():
                    if isinstance(lic, dict):
                        lic["_licenseId"] = lic_id
                        db.licenses.replace_one({"_licenseId": lic_id}, lic, upsert=True)
                entitlements = data.get("serverEntitlements", {})
                for srv_id, ent in entitlements.items():
                    if isinstance(ent, dict):
                        ent["_serverId"] = srv_id
                        db.server_entitlements.replace_one({"_serverId": srv_id}, ent, upsert=True)
                sessions = data.get("processedSessions", {})
                for sess_id, sess in sessions.items():
                    if isinstance(sess, dict):
                        sess["_sessionId"] = sess_id
                        db.processed_sessions.replace_one({"_sessionId": sess_id}, sess, upsert=True)
    except Exception:
        pass

seed_premium_if_needed()


# === Premium Helper Functions (MongoDB) ===

def load_premium():
    if db is not None:
        try:
            licenses = {}
            for doc in db.licenses.find({}, {"_id": 0}):
                lid = doc.pop("_licenseId", None)
                if lid:
                    licenses[lid] = doc
            server_ents = {}
            for doc in db.server_entitlements.find({}, {"_id": 0}):
                sid = doc.pop("_serverId", None)
                if sid:
                    server_ents[sid] = doc
            processed = {}
            for doc in db.processed_sessions.find({}, {"_id": 0}):
                sess_id = doc.pop("_sessionId", None)
                if sess_id:
                    processed[sess_id] = doc
            return {"licenses": licenses, "serverEntitlements": server_ents, "processedSessions": processed}
        except Exception:
            pass
    try:
        if PREMIUM_FILE.exists():
            data = json.loads(PREMIUM_FILE.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                return {"licenses": {}, "processedSessions": {}}
            if "licenses" not in data or not isinstance(data.get("licenses"), dict):
                data["licenses"] = {}
            if "processedSessions" not in data or not isinstance(data.get("processedSessions"), dict):
                data["processedSessions"] = {}
            return data
        return {"licenses": {}, "processedSessions": {}}
    except Exception:
        return {"licenses": {}, "processedSessions": {}}


def save_premium(data):
    if db is not None:
        try:
            for lic_id, lic in data.get("licenses", {}).items():
                if isinstance(lic, dict):
                    doc = {**lic, "_licenseId": lic_id}
                    db.licenses.replace_one({"_licenseId": lic_id}, doc, upsert=True)
            for srv_id, ent in data.get("serverEntitlements", {}).items():
                if isinstance(ent, dict):
                    doc = {**ent, "_serverId": srv_id}
                    db.server_entitlements.replace_one({"_serverId": srv_id}, doc, upsert=True)
            for sess_id, sess in data.get("processedSessions", {}).items():
                if isinstance(sess, dict):
                    doc = {**sess, "_sessionId": sess_id}
                    db.processed_sessions.replace_one({"_sessionId": sess_id}, doc, upsert=True)
            return
        except Exception:
            pass


def list_licenses_by_contact_email(email):
    needle = str(email or "").strip().lower()
    if not needle:
        return []
    data = load_premium()
    matches = []
    for key, lic in data.get("licenses", {}).items():
        if not isinstance(lic, dict):
            continue
        lic_email = str(lic.get("email") or lic.get("contactEmail") or "").strip().lower()
        if lic_email == needle:
            matches.append({"licenseKey": key, **lic})
    return matches


def reserve_trial_claim(email, payload=None):
    normalized_email = str(email or "").strip().lower()
    if not normalized_email:
        return {"ok": False}

    data = load_premium()
    claims = data.setdefault("trialClaims", {})
    if normalized_email in claims:
        return {"ok": False}

    claims[normalized_email] = {
        "email": normalized_email,
        "requestedAt": datetime.now(timezone.utc).isoformat(),
        **(payload or {}),
    }
    save_premium(data)
    return {"ok": True}


def release_trial_claim(email):
    normalized_email = str(email or "").strip().lower()
    if not normalized_email:
        return
    data = load_premium()
    claims = data.setdefault("trialClaims", {})
    if normalized_email in claims:
        claims.pop(normalized_email, None)
        save_premium(data)


def finalize_trial_claim(email, payload=None):
    normalized_email = str(email or "").strip().lower()
    if not normalized_email:
        return
    data = load_premium()
    claims = data.setdefault("trialClaims", {})
    current = claims.get(normalized_email, {})
    claims[normalized_email] = {
        **current,
        **(payload or {}),
        "finalizedAt": datetime.now(timezone.utc).isoformat(),
    }
    save_premium(data)


def list_offers(include_inactive=True):
    data = load_premium()
    offers = data.get("offers", {})
    rows = []
    for code, offer in offers.items():
        if not isinstance(offer, dict):
            continue
        row = {"code": code, **offer}
        if not include_inactive and not row.get("active", True):
            continue
        rows.append(row)
    rows.sort(key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""), reverse=True)
    return rows


def get_offer(code):
    normalized = sanitize_offer_code(code)
    if not normalized:
        return None
    data = load_premium()
    offer = data.get("offers", {}).get(normalized)
    if not isinstance(offer, dict):
        return None
    return {"code": normalized, **offer}


def upsert_offer(payload, partial=False):
    body = payload if isinstance(payload, dict) else {}
    code = sanitize_offer_code(body.get("code"))
    if not code:
        raise ValueError("code ist erforderlich.")

    data = load_premium()
    offers = data.setdefault("offers", {})
    existing = offers.get(code, {}) if isinstance(offers.get(code), dict) else {}

    if partial and not existing:
        raise ValueError("Code nicht gefunden.")

    discount_percent = parse_int(body.get("discountPercent"), existing.get("discountPercent", 0))
    discount_percent = max(0, min(100, discount_percent))
    discount_cents = parse_int(body.get("discountCents"), existing.get("discountCents", 0))
    discount_cents = max(0, discount_cents)
    max_uses = parse_int(body.get("maxUses"), existing.get("maxUses", 0))
    max_uses = max(0, max_uses)
    uses = parse_int(existing.get("uses", 0), 0)

    now_iso = datetime.now(timezone.utc).isoformat()
    next_offer = {
        **existing,
        "label": clip_text(body.get("label", existing.get("label", "")), 120),
        "description": clip_text(body.get("description", existing.get("description", "")), 400),
        "active": bool(body.get("active", existing.get("active", True))),
        "tier": str(body.get("tier", existing.get("tier", ""))).strip().lower(),
        "discountPercent": discount_percent,
        "discountCents": discount_cents,
        "maxUses": max_uses,
        "uses": uses,
        "startsAt": str(body.get("startsAt", existing.get("startsAt", ""))).strip() or None,
        "endsAt": str(body.get("endsAt", existing.get("endsAt", ""))).strip() or None,
        "createdAt": existing.get("createdAt", now_iso),
        "createdBy": str(body.get("createdBy", existing.get("createdBy", "api-admin"))).strip() or "api-admin",
        "updatedAt": now_iso,
        "updatedBy": str(body.get("updatedBy", existing.get("updatedBy", "api-admin"))).strip() or "api-admin",
    }

    if next_offer.get("tier") not in ("", "pro", "ultimate"):
        raise ValueError("tier muss leer, 'pro' oder 'ultimate' sein.")
    if next_offer.get("discountPercent", 0) <= 0 and next_offer.get("discountCents", 0) <= 0:
        raise ValueError("discountPercent oder discountCents muss gesetzt sein.")

    offers[code] = next_offer
    save_premium(data)
    return {"code": code, **next_offer}


def delete_offer(code):
    normalized = sanitize_offer_code(code)
    if not normalized:
        return False
    data = load_premium()
    offers = data.setdefault("offers", {})
    if normalized not in offers:
        return False
    offers.pop(normalized, None)
    save_premium(data)
    return True


def set_offer_active(code, active=True):
    normalized = sanitize_offer_code(code)
    if not normalized:
        return None
    data = load_premium()
    offers = data.setdefault("offers", {})
    existing = offers.get(normalized)
    if not isinstance(existing, dict):
        return None
    existing["active"] = bool(active)
    existing["updatedAt"] = datetime.now(timezone.utc).isoformat()
    existing["updatedBy"] = str(existing.get("updatedBy") or "api-admin")
    offers[normalized] = existing
    save_premium(data)
    return {"code": normalized, **existing}


def parse_iso_datetime(raw_value):
    value = str(raw_value or "").strip()
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def resolve_discount_preview(tier, seats, months, email, coupon_code, language="de"):
    lang = normalize_language(language, "de")
    def tmsg(de, en):
        return de if lang == "de" else en

    normalized_tier = str(tier or "").strip().lower()
    if normalized_tier not in ("pro", "ultimate"):
        return {"ok": False, "status": 400, "error": tmsg("tier muss 'pro' oder 'ultimate' sein.", "tier must be 'pro' or 'ultimate'.")}

    if not is_valid_email(email):
        return {"ok": False, "status": 400, "error": tmsg("Bitte eine gueltige E-Mail-Adresse eingeben.", "Please enter a valid email address.")}

    duration_months = normalize_duration(months)
    normalized_seats = max(1, min(5, parse_int(seats, 1)))
    base_amount_cents = calculate_price(normalized_tier, duration_months, normalized_seats)
    if base_amount_cents <= 0:
        return {"ok": False, "status": 400, "error": tmsg("Ungueltige Preisberechnung fuer die gewaehlte Kombination.", "Invalid price calculation for the selected combination.")}

    code = sanitize_offer_code(coupon_code)
    if not code:
        return {
            "ok": True,
            "preview": {
                "code": None,
                "discountCents": 0,
                "finalAmountCents": base_amount_cents,
                "baseAmountCents": base_amount_cents,
            },
        }

    offer = get_offer(code)
    if not offer:
        return {"ok": False, "status": 404, "error": tmsg("Gutscheincode nicht gefunden.", "Coupon code not found.")}
    if not offer.get("active", True):
        return {"ok": False, "status": 400, "error": tmsg("Gutscheincode ist nicht aktiv.", "Coupon code is not active.")}

    offer_tier = str(offer.get("tier") or "").strip().lower()
    if offer_tier and offer_tier != normalized_tier:
        return {"ok": False, "status": 400, "error": tmsg("Gutscheincode gilt nicht fuer diesen Plan.", "Coupon code is not valid for this plan.")}

    starts_at = parse_iso_datetime(offer.get("startsAt"))
    ends_at = parse_iso_datetime(offer.get("endsAt"))
    now = datetime.now(timezone.utc)
    if starts_at and starts_at > now:
        return {"ok": False, "status": 400, "error": tmsg("Gutscheincode ist noch nicht aktiv.", "Coupon code is not active yet.")}
    if ends_at and ends_at < now:
        return {"ok": False, "status": 400, "error": tmsg("Gutscheincode ist abgelaufen.", "Coupon code has expired.")}

    max_uses = max(0, parse_int(offer.get("maxUses"), 0))
    used = max(0, parse_int(offer.get("uses"), 0))
    if max_uses > 0 and used >= max_uses:
        return {"ok": False, "status": 400, "error": tmsg("Gutscheincode wurde bereits zu oft eingeloest.", "Coupon code has already been redeemed too many times.")}

    discount_percent = max(0, min(100, parse_int(offer.get("discountPercent"), 0)))
    discount_fixed = max(0, parse_int(offer.get("discountCents"), 0))
    percent_cents = round(base_amount_cents * (discount_percent / 100)) if discount_percent > 0 else 0
    discount_cents = max(percent_cents, discount_fixed)
    discount_cents = max(0, min(base_amount_cents, discount_cents))
    final_amount_cents = max(0, base_amount_cents - discount_cents)

    return {
        "ok": True,
        "preview": {
            "code": code,
            "label": offer.get("label") or code,
            "discountCents": discount_cents,
            "finalAmountCents": final_amount_cents,
            "baseAmountCents": base_amount_cents,
        },
    }


def get_discordbotlist_status(vote_limit=20):
    token = (os.environ.get("DISCORDBOTLIST_TOKEN") or "").strip()
    explicit_bot_id = (os.environ.get("DISCORDBOTLIST_BOT_ID") or "").strip()
    commander_bot_id = (os.environ.get("BOT_1_CLIENT_ID") or "").strip()
    bot_id = explicit_bot_id or commander_bot_id
    configured = (os.environ.get("DISCORDBOTLIST_ENABLED") or ("1" if token else "0")).strip() != "0" and bool(token) and bool(re.match(r"^\d{17,22}$", bot_id))
    stats_scope = "aggregate" if (os.environ.get("DISCORDBOTLIST_STATS_SCOPE") or "commander").strip().lower() == "aggregate" else "commander"

    data = load_premium()
    state = data.get("discordBotListState", {}) if isinstance(data.get("discordBotListState"), dict) else {}
    recent_votes = state.get("votes", {}).get("recent", []) if isinstance(state.get("votes"), dict) else []
    if not isinstance(recent_votes, list):
        recent_votes = []

    return {
        "configured": configured,
        "botId": bot_id or None,
        "statsScope": stats_scope,
        "state": {
            "commands": state.get("commands", {}),
            "stats": state.get("stats", {}),
            "votes": {
                "totalVotes": parse_int(state.get("votes", {}).get("totalVotes"), 0) if isinstance(state.get("votes"), dict) else 0,
                "recent": recent_votes[: max(0, int(vote_limit))],
            },
        },
    }
    tmp_file = PREMIUM_FILE.with_suffix(PREMIUM_FILE.suffix + ".tmp")
    payload = json.dumps(data, indent=2) + "\n"
    try:
        tmp_file.write_text(payload, encoding="utf-8")
        tmp_file.replace(PREMIUM_FILE)
    except Exception:
        PREMIUM_FILE.write_text(payload, encoding="utf-8")
    finally:
        try:
            if tmp_file.exists():
                tmp_file.unlink()
        except Exception:
            pass


def get_processed_session(session_id):
    sid = str(session_id or "").strip()
    if not sid:
        return None
    data = load_premium()
    return data.get("processedSessions", {}).get(sid)


def mark_processed_session(session_id, payload):
    sid = str(session_id or "").strip()
    if not sid:
        return
    data = load_premium()
    data.setdefault("processedSessions", {})[sid] = {
        **(payload or {}),
        "processedAt": datetime.now(timezone.utc).isoformat(),
    }

    # Keep processedSessions bounded.
    processed = data.get("processedSessions", {})
    if len(processed) > 5000:
        ordered = sorted(
            processed.items(),
            key=lambda entry: str(entry[1].get("processedAt", "")),
            reverse=True,
        )
        data["processedSessions"] = dict(ordered[:5000])

    save_premium(data)


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


def get_license_by_key(license_key):
    key = str(license_key or "").strip()
    if not key:
        return None
    data = load_premium()
    lic = data.get("licenses", {}).get(key)
    if not lic:
        return None
    expired = is_expired(lic)
    return {
        **lic,
        "licenseKey": key,
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


def get_duration_price(tier, months):
    months = normalize_duration(months)
    pricing = DURATION_PRICING.get(tier, {})
    return pricing.get(months, pricing.get(1, 0))


def get_seat_monthly_total(tier, seats):
    seats = max(1, int(seats) if isinstance(seats, (int, float)) else 1)
    seat_pricing = SEAT_MONTHLY_TOTAL_CENTS.get(tier, {})
    if seats in seat_pricing:
        return seat_pricing[seats]
    closest = min(SEAT_OPTIONS, key=lambda x: abs(x - seats))
    return seat_pricing.get(closest, seat_pricing.get(1, 0))


def calculate_price(tier, months, seats=1):
    months = normalize_duration(months)
    seats = max(1, int(seats) if isinstance(seats, (int, float)) else 1)
    base_1mo = get_duration_price(tier, 1)
    duration_1mo = get_duration_price(tier, months)
    if base_1mo <= 0:
        return 0
    discount_ratio = duration_1mo / base_1mo
    seat_total_1mo = get_seat_monthly_total(tier, seats)
    price_per_month = round(seat_total_1mo * discount_ratio)
    return months * price_per_month


def calculate_upgrade_price(server_id, new_tier):
    lic = get_server_license(server_id)
    if not lic or lic.get("expired"):
        return None
    old_tier = lic.get("tier", "free")
    seats = max(1, int(lic.get("seats", 1) or 1))
    old_ppm = get_seat_monthly_total(old_tier, seats)
    new_ppm = get_seat_monthly_total(new_tier, seats)
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
        "seats": seats,
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
    months = normalize_months(months)
    seats = max(1, min(5, int(seats) if isinstance(seats, (int, float)) else 1))
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


def sanitize_license_for_api(license_info, include_sensitive=False):
    if not license_info:
        return None

    plan = license_info.get("tier", license_info.get("plan", "free"))
    payload = {
        "tier": plan,
        "plan": plan,
        "seats": 1,
        "active": not bool(license_info.get("expired")),
        "expired": bool(license_info.get("expired")),
        "expiresAt": license_info.get("expiresAt"),
        "remainingDays": license_info.get("remainingDays", 0),
    }

    linked_server_ids = list(license_info.get("linkedServerIds", []))

    if include_sensitive:
        payload["linkedServerIds"] = linked_server_ids
        payload["email"] = license_info.get("email", "")
    else:
        payload["linkedServerCount"] = len(linked_server_ids)
        payload["emailMasked"] = mask_email(license_info.get("email", ""))

    return payload


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


@app.get("/api/workers")
async def get_workers():
    """Worker-Status Dashboard API. Returns commander + worker bot statuses."""
    bots_data = load_bots_from_env()

    commander = None
    workers = []

    for bot in bots_data:
        idx = int(bot.get("index", 0) or 0)
        tier = bot.get("requiredTier", "free")
        cid = bot.get("clientId", "")
        invite_url = None
        if cid and len(cid) > 10:
            invite_url = f"https://discord.com/oauth2/authorize?client_id={cid}&permissions=35186522836032&integration_type=0&scope=bot%20applications.commands"

        entry = {
            "id": bot.get("botId"),
            "botId": bot.get("botId"),
            "index": idx,
            "name": bot.get("name", f"OmniFM Bot {idx}"),
            "role": "commander" if idx == 1 else "worker",
            "requiredTier": tier,
            "online": bot.get("ready", False),
            "clientId": cid if tier == "free" else None,
            "inviteUrl": invite_url if tier == "free" else None,
            "servers": bot.get("servers", 0),
            "activeStreams": bot.get("connections", 0),
            "color": bot.get("color", "cyan"),
            "avatarUrl": bot.get("avatarUrl", ""),
        }

        if idx == 1:
            entry["role"] = "commander"
            commander = entry
        else:
            entry["role"] = "worker"
            workers.append(entry)

    # If no commander detected, use first bot
    if not commander and bots_data:
        first = bots_data[0]
        commander = {
            "id": first.get("botId", "bot-1"),
            "botId": first.get("botId", "bot-1"),
            "index": 1, "name": first.get("name", "OmniFM DJ"),
            "role": "commander", "requiredTier": "free",
            "online": first.get("ready", False),
            "clientId": first.get("clientId", ""),
            "inviteUrl": None, "servers": 0, "activeStreams": 0,
            "color": "cyan", "avatarUrl": "",
        }

    return {
        "architecture": "commander_worker",
        "commander": commander,
        "workers": workers,
        "tiers": {
            "free": {"maxWorkers": TIERS["free"]["maxBots"], "name": "Free"},
            "pro": {"maxWorkers": TIERS["pro"]["maxBots"], "name": "Pro"},
            "ultimate": {"maxWorkers": TIERS["ultimate"]["maxBots"], "name": "Ultimate"},
        },
    }


@app.get("/api/stations")
async def get_stations():
    stations_list = []
    if db is not None:
        try:
            for doc in db.stations.find({}, {"_id": 0}):
                stations_list.append({
                    "key": doc.get("key", ""),
                    "name": doc.get("name", doc.get("key", "")),
                    "url": doc.get("url", ""),
                    "tier": doc.get("tier", "free"),
                })
        except Exception:
            pass
    if not stations_list:
        file_data = load_stations_from_file()
        file_stations = file_data.get("stations", {})
        for key, val in file_stations.items():
            stations_list.append({
                "key": key,
                "name": val.get("name", key),
                "url": val.get("url", ""),
                "tier": val.get("tier", "free"),
            })
    tier_order = {"free": 0, "pro": 1, "ultimate": 2}
    stations_list.sort(key=lambda s: (tier_order.get(s["tier"], 0), s["name"]))
    default_key = None
    if db is not None:
        try:
            default_doc = db.stations.find_one({"is_default": True}, {"_id": 0, "key": 1})
            if default_doc:
                default_key = default_doc.get("key")
        except Exception:
            pass
    if not default_key:
        file_data = load_stations_from_file()
        default_key = file_data.get("defaultStationKey")
    return {
        "defaultStationKey": default_key,
        "total": len(stations_list),
        "stations": stations_list
    }


@app.get("/api/legal")
async def get_legal_notice(request: Request):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    return build_public_legal_notice()


@app.get("/api/privacy")
async def get_privacy_notice(request: Request):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    return build_public_privacy_notice()


@app.get("/api/discordbotlist/status")
async def discordbotlist_status(request: Request, limit: int = 20):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    if not is_admin_request(request):
        return json_error(401, "Unauthorized. API admin token required.")
    return get_discordbotlist_status(vote_limit=max(0, min(200, int(limit))))


@app.get("/api/stats")
async def get_stats():
    bots = load_bots_from_env()
    station_count = 0
    free_count = 0
    pro_count = 0
    if db is not None:
        try:
            station_count = db.stations.count_documents({})
            free_count = db.stations.count_documents({"tier": "free"})
            pro_count = station_count - free_count
        except Exception:
            pass
    if station_count == 0:
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
            {"name": "/help", "args": "", "description": "Zeigt alle Befehle und kurze Erklaerungen"},
            {"name": "/play", "args": "[station] [voice] [fallback] [bot]", "description": "Starte einen Radio-Stream im Voice-Channel (Ultimate: optional Fallback + YouTube-Live-URL)"},
            {"name": "/pause", "args": "", "description": "Wiedergabe pausieren"},
            {"name": "/resume", "args": "", "description": "Setzt die Wiedergabe fort"},
            {"name": "/stop", "args": "", "description": "Stoppt die Wiedergabe und verlaesst den Channel"},
            {"name": "/stations", "args": "", "description": "Zeigt alle verfuegbaren Radio-Stationen (nach Tier gefiltert)"},
            {"name": "/stats", "args": "", "description": "[Pro+] Zeigt Server-Statistiken (Ultimate: erweiterte Analytics + Tagesreport)"},
            {"name": "/now", "args": "", "description": "Zeigt die aktuelle Station und Metadaten"},
            {"name": "/history", "args": "[limit]", "description": "Zeigt die zuletzt erkannten Songs"},
            {"name": "/setvolume", "args": "<value>", "description": "Setzt die Lautstaerke"},
            {"name": "/status", "args": "", "description": "Zeigt Bot-Status, Uptime und Last"},
            {"name": "/list", "args": "[page]", "description": "Listet Stationen paginiert auf"},
            {"name": "/health", "args": "", "description": "Zeigt Stream-Health und Reconnect-Info"},
            {"name": "/diag", "args": "", "description": "Zeigt ffmpeg/Audio-Diagnose fuer Troubleshooting"},
            {"name": "/premium", "args": "", "description": "Zeigt den Premium-Status dieses Servers"},
            {"name": "/language", "args": "<show | set <value> | reset>", "description": "Sprache fuer diesen Server verwalten"},
            {"name": "/addstation", "args": "<key> <name> <url>", "description": "[Ultimate] Eigene Station hinzufuegen"},
            {"name": "/removestation", "args": "<key>", "description": "[Ultimate] Eigene Station entfernen"},
            {"name": "/mystations", "args": "", "description": "[Ultimate] Zeigt deine Custom-Stationen"},
            {"name": "/event", "args": "<create <name> <station> <voice> <start> [timezone] [repeat] [text] [serverevent] [stagetopic] [message] | list | delete <id>>", "description": "[Pro] Event-Scheduler fuer automatische Starts"},
            {"name": "/license", "args": "<activate <key> | info | remove>", "description": "Lizenz verwalten: aktivieren, anzeigen oder entfernen"},
            {"name": "/perm", "args": "<allow <command> <role> | deny <command> <role> | remove <command> <role> | list [command] | reset [command]>", "description": "[Pro] Rollenrechte fuer Commands verwalten"},
            {"name": "/invite", "args": "<worker>", "description": "[Pro] Worker-Bot auf deinen Server einladen"},
            {"name": "/workers", "args": "", "description": "[Pro] Zeigt den Status aller Worker-Bots"},
        ]
    }


# === Premium API ===

@app.get("/api/premium/check")
async def check_premium(request: Request, serverId: str = "", licenseKey: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited

    include_sensitive = is_admin_request(request)

    # Lizenz per Key suchen
    if licenseKey:
        data = load_premium()
        licenses = data.get("licenses", {})
        lic = licenses.get(licenseKey)
        resolved_key = licenseKey
        if not lic:
            lower_query = licenseKey.lower()
            for key, value in licenses.items():
                if str(key).lower() == lower_query:
                    lic = value
                    resolved_key = key
                    break
        if not lic:
            return json_error(404, "Lizenz-Key nicht gefunden.")
        expired = is_expired(lic)
        normalized = {
            **lic,
            "tier": lic.get("tier", lic.get("plan", "free")),
            "plan": lic.get("plan", lic.get("tier", "free")),
            "expired": expired,
            "remainingDays": remaining_days(lic),
        }
        return {"licenseKey": resolved_key, **sanitize_license_for_api(normalized, include_sensitive)}

    # Fallback: Server-ID basiert
    if not is_valid_server_id(serverId):
        return json_error(400, "serverId oder licenseKey erforderlich (17-22 Ziffern).")

    server_id = str(serverId).strip()
    tier = get_tier(server_id)
    tier_config = TIERS.get(tier, TIERS["free"])
    license_info = get_license(server_id)
    return {
        "serverId": server_id,
        "tier": tier,
        **tier_config,
        "license": sanitize_license_for_api(license_info, include_sensitive),
    }


@app.get("/api/premium/tiers")
async def get_tiers(request: Request):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    return {"tiers": TIERS}


@app.post("/api/premium/trial")
async def activate_trial(request: Request, body: dict):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited

    payload = body if isinstance(body, dict) else {}
    language = normalize_language(
        payload.get("language"),
        resolve_language_from_accept_language(request.headers.get("accept-language"), "de"),
    )
    def tmsg(de, en):
        return de if language == "de" else en
    email = str(payload.get("email", "")).strip().lower()

    if not is_pro_trial_enabled():
        return JSONResponse(
            status_code=403,
            content={
                "success": False,
                "message": tmsg(
                    "Der Pro-Testmonat ist aktuell deaktiviert.",
                    "The Pro trial month is currently disabled.",
                ),
            },
        )

    if not is_valid_email(email):
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "message": tmsg(
                    "Bitte eine gueltige E-Mail-Adresse eingeben.",
                    "Please enter a valid email address.",
                ),
            },
        )

    if list_licenses_by_contact_email(email):
        return JSONResponse(
            status_code=409,
            content={
                "success": False,
                "message": tmsg(
                    "Für diese E-Mail existiert bereits eine Lizenz. Der Testmonat ist nur einmalig für Neukunden verfügbar.",
                    "A license already exists for this email. The trial month is only available once for new customers.",
                ),
            },
        )

    reserved = reserve_trial_claim(
        email,
        {
            "source": "api:trial",
            "preferredLanguage": language,
            "requestedAt": datetime.now(timezone.utc).isoformat(),
        },
    )
    if not reserved.get("ok"):
        return JSONResponse(
            status_code=409,
            content={
                "success": False,
                "message": tmsg(
                    "Der Pro-Testmonat wurde fuer diese E-Mail bereits genutzt.",
                    "The Pro trial month has already been used for this email.",
                ),
            },
        )

    try:
        license_data = add_license(
            email,
            "pro",
            PRO_TRIAL_MONTHS,
            PRO_TRIAL_SEATS,
            "trial",
            "Trial via api:trial",
        )
    except Exception as exc:
        release_trial_claim(email)
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "message": tmsg(
                    "Der Pro-Testmonat konnte nicht erstellt werden. Bitte spaeter erneut versuchen.",
                    "Could not create the Pro trial month. Please try again later.",
                ),
                "detail": clip_text(exc),
            },
        )

    finalize_trial_claim(
        email,
        {
            "source": "api:trial",
            "licenseId": license_data.get("licenseKey"),
            "tier": "pro",
            "seats": PRO_TRIAL_SEATS,
            "months": PRO_TRIAL_MONTHS,
            "expiresAt": license_data.get("expiresAt"),
            "activatedBy": "trial",
        },
    )

    smtp_configured = bool((os.environ.get("SMTP_HOST") or "").strip())
    email_status = {
        "smtpConfigured": smtp_configured,
        "purchaseSent": False,
        "invoiceSent": False,
        "adminSent": False,
        "errors": [] if smtp_configured else ["smtp_not_configured"],
    }

    message = tmsg(
        f"Pro-Testmonat aktiviert! Lizenz-Key: {license_data.get('licenseKey')} - Pruefe deine E-Mail ({email}).",
        f"Pro trial month activated! License key: {license_data.get('licenseKey')} - Check your email ({email}).",
    )
    if not smtp_configured:
        message = tmsg(
            f"Pro-Testmonat aktiviert! Lizenz-Key: {license_data.get('licenseKey')}. Hinweis: SMTP ist nicht konfiguriert, daher wurde keine E-Mail versendet.",
            f"Pro trial month activated! License key: {license_data.get('licenseKey')}. Note: SMTP is not configured, so no email was sent.",
        )

    return {
        "success": True,
        "email": email,
        "tier": "pro",
        "licenseKey": license_data.get("licenseKey"),
        "expiresAt": license_data.get("expiresAt"),
        "seats": PRO_TRIAL_SEATS,
        "months": PRO_TRIAL_MONTHS,
        "message": message,
        "emailStatus": email_status,
    }


@app.post("/api/premium/offer/preview")
async def premium_offer_preview(request: Request, body: dict):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited

    payload = body if isinstance(body, dict) else {}
    language = normalize_language(
        payload.get("language"),
        resolve_language_from_accept_language(request.headers.get("accept-language"), "de"),
    )
    result = resolve_discount_preview(
        tier=payload.get("tier"),
        seats=payload.get("seats", 1),
        months=payload.get("months", 1),
        email=payload.get("email"),
        coupon_code=payload.get("couponCode") or payload.get("coupon") or "",
        language=language,
    )
    if not result.get("ok"):
        return JSONResponse(
            status_code=int(result.get("status", 400)),
            content={
                "success": False,
                "error": result.get("error", "Offer-Vorschau fehlgeschlagen."),
                "discount": result.get("preview"),
            },
        )

    preview = result.get("preview", {})
    return {
        "success": True,
        "discount": preview,
        "pricing": {
            "baseAmountCents": preview.get("baseAmountCents", 0),
            "discountCents": preview.get("discountCents", 0),
            "finalAmountCents": preview.get("finalAmountCents", preview.get("baseAmountCents", 0)),
        },
    }


@app.get("/api/premium/offer")
async def premium_offer(request: Request, code: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    normalized_code = sanitize_offer_code(code)
    if not normalized_code:
        return json_error(400, "code ist erforderlich.")
    offer = get_offer(normalized_code)
    if not offer:
        return json_error(404, "Code nicht gefunden.")
    return {"offer": offer}


@app.api_route("/api/premium/offers", methods=["GET", "POST", "PATCH", "DELETE"])
async def premium_offers(request: Request):
    rate_scope = "read" if request.method == "GET" else "write"
    rate_limited = enforce_api_rate_limit(request, rate_scope)
    if rate_limited is not None:
        return rate_limited

    if not is_admin_request(request):
        return json_error(401, "Unauthorized. API admin token required.")

    if request.method == "GET":
        include_inactive = request.query_params.get("includeInactive", "1") != "0"
        offers = list_offers(include_inactive=include_inactive)
        return {"offers": offers}

    if request.method in ("POST", "PATCH"):
        try:
            body = await request.json()
            if not isinstance(body, dict):
                body = {}
        except Exception:
            body = {}
        actor = clip_text(
            request.headers.get("x-admin-user") or body.get("updatedBy") or "api-admin",
            120,
        )
        try:
            offer = upsert_offer(
                {
                    **body,
                    "updatedBy": actor,
                    "createdBy": body.get("createdBy") or actor,
                },
                partial=request.method == "PATCH",
            )
            return {"success": True, "offer": offer}
        except Exception as exc:
            return JSONResponse(
                status_code=400,
                content={"success": False, "error": clip_text(exc)},
            )

    if request.method == "DELETE":
        code = sanitize_offer_code(request.query_params.get("code", ""))
        if not code:
            return JSONResponse(status_code=400, content={"success": False, "error": "code ist erforderlich."})
        deleted = delete_offer(code)
        return JSONResponse(status_code=200 if deleted else 404, content={"success": deleted, "code": code})

    return json_error(405, "Methode nicht erlaubt.")


@app.post("/api/premium/offers/active")
async def premium_offer_active(request: Request, body: dict):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited

    if not is_admin_request(request):
        return json_error(401, "Unauthorized. API admin token required.")

    payload = body if isinstance(body, dict) else {}
    code = sanitize_offer_code(payload.get("code"))
    if not code:
        return JSONResponse(status_code=400, content={"success": False, "error": "code ist erforderlich."})
    offer = set_offer_active(code, payload.get("active", True))
    if not offer:
        return JSONResponse(status_code=404, content={"success": False, "error": "Code nicht gefunden."})
    return {"success": True, "offer": offer}


@app.get("/api/premium/redemptions")
async def premium_redemptions(request: Request, limit: int = 100):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited
    if not is_admin_request(request):
        return json_error(401, "Unauthorized. API admin token required.")
    safe_limit = max(1, min(500, int(limit)))
    data = load_premium()
    rows = data.get("recentRedemptions", [])
    if not isinstance(rows, list):
        rows = []
    return {"redemptions": rows[:safe_limit]}


@app.get("/api/premium/pricing")
async def get_pricing(request: Request, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited

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
                "durationPricing": {str(k): f"{v/100:.2f}" for k, v in DURATION_PRICING["pro"].items()},
                "seatPricing": {str(k): f"{v/100:.2f}" for k, v in SEAT_MONTHLY_TOTAL_CENTS["pro"].items()},
                "features": ["128k Bitrate (HQ Opus)", "Bis zu 8 Bots", "120 Stationen (Free + Pro)", "Priority Reconnect (1,5s)", "Rollenbasierte Berechtigungen", "Event-Scheduler"]
            },
            "ultimate": {
                "name": "Ultimate",
                "pricePerMonth": TIERS["ultimate"]["pricePerMonth"],
                "startingAt": "4,99",
                "durationPricing": {str(k): f"{v/100:.2f}" for k, v in DURATION_PRICING["ultimate"].items()},
                "seatPricing": {str(k): f"{v/100:.2f}" for k, v in SEAT_MONTHLY_TOTAL_CENTS["ultimate"].items()},
                "features": ["320k Bitrate (Ultra HQ)", "Bis zu 16 Bots", "Alle Stationen + Custom URLs", "Instant Reconnect (0,4s)", "Rollenbasierte Berechtigungen"]
            },
        },
        "durations": DURATION_OPTIONS,
        "seatOptions": SEAT_OPTIONS,
        "trial": {
            "enabled": is_pro_trial_enabled(),
            "tier": "pro",
            "months": PRO_TRIAL_MONTHS,
            "oneTimePerEmail": True,
        },
    }
    if is_valid_server_id(serverId):
        server_id = str(serverId).strip()
        license_info = get_license(server_id)
        if license_info and not license_info.get("expired"):
            result["currentLicense"] = {
                "tier": license_info.get("tier", license_info.get("plan", "free")),
                "seats": max(1, int(license_info.get("seats", 1) or 1)),
                "expiresAt": license_info.get("expiresAt"),
                "remainingDays": license_info.get("remainingDays", 0),
            }
            if license_info.get("tier", "") == "pro":
                upgrade = calculate_upgrade_price(server_id, "ultimate")
                if upgrade:
                    result["upgrade"] = {
                        "to": "ultimate",
                        "seats": upgrade["seats"],
                        "cost": upgrade["upgradeCost"],
                        "daysLeft": upgrade["daysLeft"],
                    }
    return result


@app.get("/api/premium/invite-links")
async def premium_invite_links(request: Request, serverId: str = ""):
    rate_limited = enforce_api_rate_limit(request, "read")
    if rate_limited is not None:
        return rate_limited

    if not is_valid_server_id(serverId):
        return json_error(400, "serverId muss 17-22 Ziffern sein.")

    server_id = str(serverId).strip()
    tier = get_tier(server_id)
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
            invite = f"https://discord.com/oauth2/authorize?client_id={cid}&permissions=35186522836032&integration_type=0&scope=bot%20applications.commands" if cid else None
        links.append({
            "botId": bot["botId"],
            "name": bot["name"],
            "index": bot_index,
            "requiredTier": bot_tier,
            "hasAccess": has_access,
            "blockedReason": blocked_reason,
            "inviteUrl": invite,
        })
    return {"serverId": server_id, "serverTier": tier, "serverMaxBots": max_bots, "bots": links}


@app.post("/api/premium/checkout")
async def premium_checkout(request: Request, body: dict):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited

    tier = str(body.get("tier", "")).strip().lower()
    email = str(body.get("email", "")).strip().lower()
    duration_months = normalize_months(body.get("months", 1))
    seats = max(1, min(5, parse_int(body.get("seats", 1), 1)))
    return_url = str(body.get("returnUrl", "")).strip()

    if tier not in ("pro", "ultimate"):
        return json_error(400, "tier muss 'pro' oder 'ultimate' sein.")
    if not is_valid_email(email):
        return json_error(400, "Bitte eine gueltige E-Mail-Adresse angeben.")

    stripe_key = get_stripe_secret_key()
    valid, msg = validate_stripe_key(stripe_key)
    if not valid:
        return json_error(503, msg)

    try:
        import stripe
        stripe.api_key = stripe_key

        price_in_cents = calculate_price(tier, duration_months, seats)
        if price_in_cents <= 0:
            return json_error(400, "Ungueltige Preisberechnung.")

        tier_name = TIERS[tier]["name"]
        seats_label = f" ({seats} Server)" if seats > 1 else ""
        if duration_months >= 12:
            description = f"{tier_name}{seats_label} - {duration_months} Monate (Jahresrabatt: 2 Monate gratis!)"
        else:
            description = f"{tier_name}{seats_label} - {duration_months} Monat{'e' if duration_months > 1 else ''}"

        return_base = resolve_checkout_return_base(return_url)

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
            success_url=return_base + "?payment=success&session_id={CHECKOUT_SESSION_ID}",
            cancel_url=return_base + "?payment=cancelled",
        )
        return {"sessionId": session.id, "url": session.url}
    except Exception as e:
        return json_error(500, f"Checkout fehlgeschlagen: {clip_text(e)}")


@app.post("/api/premium/verify")
async def verify_premium(request: Request, body: dict):
    rate_limited = enforce_api_rate_limit(request, "write")
    if rate_limited is not None:
        return rate_limited

    session_id = str(body.get("sessionId", "")).strip()
    if not session_id:
        return json_error(400, "sessionId erforderlich.")

    processed = get_processed_session(session_id)
    if processed:
        license_key = str(processed.get("licenseKey", "")).strip()
        existing_license = get_license_by_key(license_key)
        if existing_license:
            return {
                "success": True,
                "replay": True,
                "licenseKey": license_key,
                "email": existing_license.get("email"),
                "tier": existing_license.get("tier"),
                "seats": existing_license.get("seats"),
                "expiresAt": existing_license.get("expiresAt"),
                "message": "Session wurde bereits verarbeitet.",
            }
        return {
            "success": True,
            "replay": True,
            "licenseKey": license_key or None,
            "email": processed.get("email"),
            "tier": processed.get("tier"),
            "seats": processed.get("seats"),
            "expiresAt": processed.get("expiresAt"),
            "message": "Session wurde bereits verarbeitet.",
        }

    stripe_key = get_stripe_secret_key()
    valid, msg = validate_stripe_key(stripe_key)
    if not valid:
        return json_error(503, msg)

    try:
        import stripe
        stripe.api_key = stripe_key
        session = stripe.checkout.Session.retrieve(session_id)

        if session.payment_status == "paid":
            processed_race = get_processed_session(session_id)
            if processed_race:
                license_key = str(processed_race.get("licenseKey", "")).strip()
                existing_license = get_license_by_key(license_key)
                if existing_license:
                    return {
                        "success": True,
                        "replay": True,
                        "licenseKey": license_key,
                        "email": existing_license.get("email"),
                        "tier": existing_license.get("tier"),
                        "seats": existing_license.get("seats"),
                        "expiresAt": existing_license.get("expiresAt"),
                        "message": "Session wurde bereits verarbeitet.",
                    }

            metadata = session.metadata or {}
            email = str(metadata.get("email", "")).strip().lower()
            tier = str(metadata.get("tier", "")).strip().lower()
            months_str = metadata.get("months", "1")
            seats_str = metadata.get("seats", "1")
            seats = max(1, min(5, parse_int(seats_str, 1)))

            if is_valid_email(email) and tier in ("pro", "ultimate"):
                duration_months = normalize_months(months_str)
                license_data = add_license(email, tier, duration_months, seats, "stripe", f"Session: {session_id}")
                mark_processed_session(
                    session_id,
                    {
                        "licenseKey": license_data.get("licenseKey"),
                        "email": email,
                        "tier": tier,
                        "seats": seats,
                        "expiresAt": license_data.get("expiresAt"),
                    },
                )

                license_key = license_data.get("licenseKey", "")
                tier_name = TIERS[tier]["name"]
                msg = f"Lizenz {license_key} erstellt! {tier_name} fuer {seats} Server, {duration_months} Monat{'e' if duration_months > 1 else ''}."

                return {
                    "success": True,
                    "replay": False,
                    "licenseKey": license_key,
                    "email": email,
                    "tier": tier,
                    "seats": seats,
                    "expiresAt": license_data.get("expiresAt"),
                    "message": msg,
                }

        return {"success": False, "message": "Zahlung nicht abgeschlossen."}
    except Exception as e:
        return json_error(500, f"Verifizierung fehlgeschlagen: {clip_text(e)}")
