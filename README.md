# OmniFM v3.0

24/7 Discord Radio Streaming Bot mit Premium Tier-System.

## Features

- 3-Tier System (Free / Pro / Ultimate)
- Seat-basierte Server-Lizenzierung (1/2/3/5 Server)
- Tiered Station Access (20 Free + 100 Pro Stationen)
- Plan-basierte Audio-Qualitaet (64k/128k/320k)
- Priority Reconnect (5s/1.5s/0.4s)
- Custom Station URLs (Ultimate)
- Stripe Checkout Integration
- E-Mail Benachrichtigungen (Kaufbeleg, Ablauf-Warnung)

## Setup

```bash
./install.sh
```

## Management

```bash
./update.sh           # Update & Management CLI
./update.sh --stripe  # Stripe API Key konfigurieren
./update.sh --email-settings  # SMTP konfigurieren
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
| `STRIPE_SECRET_KEY` | Stripe Secret Key |
| `STRIPE_WEBHOOK_SECRET` | Stripe Webhook Secret |
