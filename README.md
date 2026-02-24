# OmniFM v3.0

24/7 Discord Radio Streaming Bot mit Premium Tier-System und Seat-basierter Lizenzierung.

## Features

- 3-Tier System (Free / Pro / Ultimate)
- Seat-basierte Server-Lizenzierung (1/2/3/5 Server)
- Auto-Verlaengerung bestehender Lizenz pro E-Mail (kein neuer Key bei Renewal/Upgrade)
- Tiered Station Access (20 Free + 100 Pro Stationen)
- Plan-basierte Audio-Qualitaet (64k/128k/320k)
- Priority Reconnect (5s/1.5s/0.4s)
- Custom Station URLs (Ultimate)
- Stripe Checkout Integration
- Einmaliger Pro-Testmonat pro E-Mail
- E-Mail Benachrichtigungen (Kaufbeleg, Ablauf-Warnung)

## Setup

```bash
./install.sh
```

## Management

```bash
./update.sh           # Update & Management CLI
./update.sh --stripe  # Stripe API Key konfigurieren
./update.sh --email   # SMTP konfigurieren
```

## Docker

```bash
docker compose up -d
docker compose logs -f omnifm
```

## Architektur

```
src/
  index.js            # Haupt-Applikation
  config/plans.js     # Plan-Konfiguration (Single Source of Truth)
  core/entitlements.js # Server-Plan & Feature-Checks
  services/pricing.js  # Seat-basiertes Pricing
  services/stations.js # Station-Management
  ui/upgradeEmbeds.js  # Discord Upgrade-Embeds
  premium-store.js     # Lizenz-Verwaltung (JSON Store)
  bot-state.js         # Bot-State Persistenz
  commands.js          # Slash-Command Definitionen
  email.js             # E-Mail Service (Nodemailer)
web/
  index.html           # OmniFM Website
  app.js               # Frontend Logik
  styles.css           # Styles
```

## Umgebungsvariablen

| Variable | Beschreibung |
|----------|-------------|
| `BOT_N_TOKEN` | Discord Bot Token |
| `BOT_N_CLIENT_ID` | Discord Client ID |
| `BOT_N_NAME` | Bot-Anzeigename |
| `PUBLIC_WEB_URL` | Oeffentliche URL der Website |
| `CORS_ALLOWED_ORIGINS` | Komma-Liste erlaubter Web-Origin URLs (API CORS) |
| `CHECKOUT_RETURN_ORIGINS` | Komma-Liste erlaubter Return-URLs fuer Stripe Checkout |
| `PRO_TRIAL_ENABLED` | `1` = Pro-Testmonat (1 Monat, 1x pro E-Mail) aktiv, `0` = deaktiviert |
| `API_ADMIN_TOKEN` | Optionales Admin-Token fuer sensible API-Felder |
| `TRUST_PROXY_HEADERS` | `1` wenn der Bot hinter einem Reverse Proxy laeuft (nutzt `X-Forwarded-*` fuer Origin/IP) |
| `API_RATE_STATE_MAX_ENTRIES` | Maximale Anzahl Rate-Limit-Eintraege im Speicher (Default: `50000`) |
| `STRIPE_SECRET_KEY` | Stripe Secret Key |
| `STRIPE_WEBHOOK_SECRET` | Stripe Webhook Secret |

### Netzwerk/Reconnect Tuning (optional)

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `STREAM_STABLE_RESET_MS` | `15000` | Nach dieser stabilen Laufzeit werden Stream-Fehlerzaehler zurueckgesetzt |
| `STREAM_RESTART_BASE_MS` | `1000` | Basis-Delay fuer Stream-Restarts bei Fehlern |
| `STREAM_RESTART_MAX_MS` | `120000` | Maximaler Stream-Restart-Delay (Backoff-Cap) |
| `STREAM_ERROR_COOLDOWN_THRESHOLD` | `8` | Ab wie vielen Fehlern in Reihe ein harter Cooldown greift |
| `STREAM_ERROR_COOLDOWN_MS` | `60000` | Harter Cooldown bei vielen Stream-Fehlern |
| `VOICE_RECONNECT_MAX_MS` | `120000` | Maximaler Voice-Reconnect-Delay (Backoff-Cap) |
| `NETWORK_COOLDOWN_BASE_MS` | `10000` | Start-Cooldown bei erkannten DNS/Netzwerkfehlern |
| `NETWORK_COOLDOWN_MAX_MS` | `180000` | Maximaler globaler Netzwerk-Cooldown |
