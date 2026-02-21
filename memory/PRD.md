# OmniFM - Product Requirements Document v3.0

## Produkt
OmniFM - 24/7 Discord Radio Streaming Bot mit Premium Tier-System und Seat-basierter Lizenzierung.

## Architektur
- **Backend**: Node.js, discord.js, Express.js
- **Frontend**: Static HTML/CSS/JS (`/web/`)
- **State**: Flat-file JSON (`premium.json`, `bot-state.json`, `custom-stations.json`, `stations.json`)
- **Payment**: Stripe Checkout (One-time payments)
- **Email**: Nodemailer (SMTP)

## Modulstruktur
```
src/
  index.js              # Haupt-Applikation (Discord Bots + Web-Server)
  config/plans.js       # Plan-Konfiguration (Single Source of Truth)
  core/entitlements.js  # Server-Plan & Feature-Checks
  services/pricing.js   # Seat-basiertes Pricing
  services/stations.js  # Station-Daten (Free/Pro JSON)
  ui/upgradeEmbeds.js   # Discord Upgrade-Embeds (Deutsch)
  premium-store.js      # Lizenz-Verwaltung (JSON Store)
  bot-state.js          # Bot-State Persistenz
  commands.js           # Slash-Command Definitionen (Deutsch)
  stations-store.js     # Station-Lade/Filter-Logik
  custom-stations.js    # Custom Station URLs (Ultimate)
  email.js              # E-Mail Service
  bot-config.js         # Bot-Konfiguration
  premium-cli.js        # CLI fuer Lizenzverwaltung
```

## Plan-System (3 Tiers)

| Feature | Free | Pro | Ultimate |
|---------|------|-----|----------|
| Max Bots | 2 | 8 | 16 |
| Bitrate | 64k | 128k Opus | 320k Opus |
| Reconnect | 5s | 1.5s | 0.4s |
| Stationen | 20 Free | 20 Free + 100 Pro | Alle + Custom URLs |
| Custom URLs | - | - | 50 pro Server |
| Preis (1 Server) | 0€ | 2.99€/mo | 4.99€/mo |

## Seat-basierte Lizenzierung
- 1, 2, 3 oder 5 Server pro Lizenz
- Seat-Preise: Pro 1=€2.99, 2=€5.49, 3=€7.49, 5=€11.49
- Seat-Preise: Ultimate 1=€4.99, 2=€7.99, 3=€10.99, 5=€16.99
- Jahresrabatt: 12 Monate buchen = 10 bezahlen

## API Endpoints
- `GET /api/premium/tiers` - Plan-Konfiguration
- `GET /api/premium/pricing` - Pricing mit Upgrade-Info
- `POST /api/premium/checkout` - Stripe Checkout Session
- `POST /api/premium/webhook` - Stripe Webhook
- `POST /api/premium/verify` - Payment Verification
- `GET /api/bots` - Bot-Status
- `GET /api/stations` - Station-Liste

## Implementiert (v3.0)
- [x] Komplett-Rebranding: RadioBot → OmniFM (Code, UI, CLI, Docker, Docs)
- [x] 3-Tier Plan-System (Free/Pro/Ultimate) mit zentraler Config
- [x] Seat-basierte Server-Lizenzierung (1/2/3/5 Seats)
- [x] Station-Tier-System (Free: 20, Pro: 100, Ultimate: alle + custom)
- [x] Plan-basierte Audio-Bitrate Enforcement (64k/128k/320k)
- [x] Plan-basierte Reconnect-Prioritaet (5s/1.5s/0.4s)
- [x] Command Permission Matrix mit Upgrade-Embeds
- [x] Pricing Calculator (services/pricing.js)
- [x] Website aktualisiert (OmniFM Branding, neue Preise)
- [x] Upgrade-Embeds Modul (Deutsch) fuer Feature-Paywalls
- [x] Docker + Shell-Skripte aktualisiert
- [x] Integrationstest: Alle Module funktionsfaehig

## Bekannte Einschraenkungen
- Bot kann in Preview-Umgebung nicht gestartet werden (keine Discord-Tokens)
- Stripe-Integration erfordert aktive API-Keys
- SMTP erfordert konfigurierte Credentials
