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
- Song-History pro Server (`/history`)
- Coupon- und Referral-Codes fuer Checkout-Rabatte
- Event-Scheduler mit Voice/Stage-Unterstuetzung (`/event`)
- Optionales Discord-Server-Event + Stage-Topic fuer geplante Events
- Konsistente DE/EN Bot-Sprache (automatisch nach Server-Locale, optional manuell via `/language`)

## Setup

```bash
./install.sh
```

## Management

```bash
./update.sh           # Update & Management CLI
./update.sh --stripe  # Stripe API Key konfigurieren
./update.sh --email   # SMTP konfigurieren
./update.sh --premium # Lizenz-, Coupon- und Referral-Verwaltung (Wizard)
./update.sh --offers  # Direkt in Coupon/Referral-Verwaltung (Pro/Ultimate Codes)
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
| `LICENSE_EXPIRY_REMINDER_DAYS` | Komma-Liste der Erinnerungen vor Ablauf (Default: `30,14,7,1`) |
| `NOW_PLAYING_ENABLED` | `1` = Live-Now-Playing Embed im Voice-Textchat aktiv, `0` = aus |
| `NOW_PLAYING_POLL_MS` | Polling-Intervall fuer Track-Metadaten (Default: `45000`) |
| `NOW_PLAYING_COVER_ENABLED` | `1` = Album-Cover (iTunes Lookup) aktiv, `0` = ohne Cover |
| `SONG_HISTORY_ENABLED` | `1` = `/history` aktiv, `0` = deaktiviert |
| `SONG_HISTORY_MAX_PER_GUILD` | Max. gespeicherte Songs pro Server (Default: `120`) |
| `SONG_HISTORY_DEDUPE_WINDOW_MS` | Dedupe-Zeitfenster fuer identische Tracks (Default: `120000`) |
| `EVENT_SCHEDULER_ENABLED` | `1` = Geplante `/event`-Starts aktiv, `0` = Scheduler aus |
| `EVENT_SCHEDULER_POLL_MS` | Polling-Intervall fuer Event-Ausfuehrung (Default: `15000`) |
| `EVENT_SCHEDULER_RETRY_MS` | Retry-Delay bei Event-Fehler (Default: `120000`) |
| `EVENT_DEFAULT_TIMEZONE` | Fallback-Zeitzone fuer `/event` (Default: Server-Zone, sonst `UTC`) |
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

### Coupon/Referral API (optional)

Coupon/Referral Codes koennen direkt ueber `./update.sh --premium` verwaltet werden
(im Premium-CLI: Option `10`).
Fuer schnellen Direktzugang: `./update.sh --offers`.

### Coupon/Referral Praxis: getrennte Pro/Ultimate Codes

Empfehlung: pro Tier eigene Codes mit eigenen Rabatten nutzen.

- Beispiel Coupon-Codes:
  - `PRO10` -> nur Pro, 10%
  - `ULTI15` -> nur Ultimate, 15%
- Beispiel Referral-Codes:
  - `CREATORPRO` -> nur Pro, z.B. 5%
  - `CREATORULTI` -> nur Ultimate, z.B. 8%

Das geht im CLI jetzt direkt ueber den Schnellsetup:

1. `./update.sh --offers`
2. `2) Schnellsetup PRO + ULTIMATE Codes`
3. Typ waehlen (`coupon` oder `referral`)
4. Pro/Ultimate Code + Rabatt getrennt eintragen

Technisch wird pro Code automatisch `allowedTiers` gesetzt (`pro` bzw. `ultimate`), damit keine falsche Plan-Anwendung passiert.

- `POST /api/premium/offer/preview`:
  - Body: `tier`, `seats`, `months`, `email`, optional `couponCode`, `referralCode`
  - Liefert Rabatt-Vorschau + finale Checkout-Summe.
- `GET/POST/PATCH/DELETE /api/premium/offers` (Admin-Token erforderlich):
  - Codes anlegen, aktualisieren, deaktivieren/loeschen.
- `POST /api/premium/offers/active` (Admin-Token erforderlich):
  - Code aktiv/inaktiv schalten.
- `GET /api/premium/redemptions` (Admin-Token erforderlich):
  - Letzte Code-Einloesungen.

### Event Scheduler (Stage + Voice)

- `/event create` unterstuetzt jetzt zusaetzlich:
  - `serverevent` (boolean): Discord-Server-Event automatisch anlegen
  - `stagetopic` (string): Stage-Thema mit Platzhaltern `{event}`, `{station}`, `{time}`
- Stage-Channels werden beim Event-Start vorbereitet (Stage-Topic/Stage-Instance/Speaker-Request).

### Discord Sprache (DE/EN)

- Standard: OmniFM nutzt die Discord-Serversprache (`guildLocale`) als Antwortsprache.
- Optionaler Override pro Server:
  - `/language show` - aktive Sprache + Quelle anzeigen
  - `/language set value:de|en` - Sprache manuell setzen
  - `/language reset` - auf automatische Server-Sprache zuruecksetzen
