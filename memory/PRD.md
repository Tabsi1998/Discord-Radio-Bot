# OmniFM - Product Requirements Document v3.0

## Produkt
OmniFM - 24/7 Discord Radio Streaming Bot mit Premium Tier-System und Seat-basierter Lizenzierung.

## Architektur
- **Backend (Bot)**: Node.js, discord.js, Express.js (`/app/src/index.js`)
- **Backend (API)**: Python FastAPI (`/app/backend/server.py`)
- **Frontend**: React (`/app/frontend/src/`)
- **Static Web**: HTML/CSS/JS (`/app/web/`)
- **State**: Flat-file JSON (`premium.json`, `bot-state.json`, `custom-stations.json`, `stations.json`)
- **Payment**: Stripe Checkout (One-time payments)
- **Email**: Nodemailer (SMTP)

## Plan-System (3 Tiers)

| Feature | Free | Pro | Ultimate |
|---------|------|-----|----------|
| Max Bots | 2 | 8 | 16 |
| Bitrate | 64k | 128k Opus | 320k Opus |
| Reconnect | 5s | 1.5s | 0.4s |
| Stationen | 20 Free | 20 Free + 100 Pro | Alle + Custom URLs |
| Custom URLs | - | - | 50 pro Server |
| Preis (1 Server) | 0 | 2.99/mo | 4.99/mo |

## Seat-basierte Lizenzierung
- 1, 2, 3 oder 5 Server pro Lizenz
- Pro Seats: 1=2.99, 2=5.49, 3=7.49, 5=11.49
- Ultimate Seats: 1=4.99, 2=7.99, 3=10.99, 5=16.99
- Jahresrabatt: 12 Monate buchen = 10 bezahlen

## Implementiert (v3.0) - Stand: 22.02.2026
- [x] Komplett-Rebranding: RadioBot -> OmniFM (Code, UI, CLI, Docker, Docs)
- [x] 3-Tier Plan-System (Free/Pro/Ultimate) mit zentraler Config
- [x] Seat-basierte Server-Lizenzierung (1/2/3/5 Seats)
- [x] Station-Tier-System (Free/Pro Badges in UI + Filter)
- [x] Plan-basierte Audio-Bitrate Enforcement (64k/128k/320k) - FIX 22.02.2026: Transcode wird immer erzwungen wenn bitrateOverride gesetzt
- [x] Plan-basierte Reconnect-Prioritaet (5s/1.5s/0.4s)
- [x] Command Permission Matrix mit Upgrade-Embeds (Deutsch)
- [x] Pricing Calculator (services/pricing.js)
- [x] Website aktualisiert (OmniFM Branding, neue Preise, Seat-Pricing-Tabelle)
- [x] Seat-Selektor im Checkout-Modal (1/2/3/5 Server mit Preisanzeige)
- [x] Tier-Filter (ALLE/FREE/PRO) im Stations-Browser
- [x] Deutsche Preisformatierung (2,99€ statt 2.99€)
- [x] FastAPI Backend komplett aktualisiert (TIERS, SEAT_PRICING, APIs)
- [x] React Frontend komplett aktualisiert (alle Komponenten)
- [x] Docker + Shell-Skripte aktualisiert
- [x] P0 Fix: Bitrate-Enforcement via bitrateOverride in createResource (22.02.2026)
- [x] CLI-Fix: premium-cli.js Imports nach Refactoring repariert (22.02.2026)
- [x] E-Mail: Bestaetigungs-E-Mail mit Server-Aenderungs-Hinweis (22.02.2026)
- [x] Rebranding-Cleanup: package.json, systemd service, README (22.02.2026)
- [x] QA-Pass: Vollstaendiger Test aller APIs, Frontend, CLI, Code-Level (22.02.2026)
- [x] E-Mail-basierter Checkout: Server-ID durch E-Mail ersetzt (22.02.2026)
- [x] Lizenz-Key System: OMNI-XXXX-XXXX-XXXX Format, automatische Generierung (22.02.2026)
- [x] Server-Zuweisung per Support: E-Mail/Discord statt Checkout (22.02.2026)
- [x] Checkout-Modal redesigned: E-Mail Input, Lizenz-Key Info-Hinweis (22.02.2026)
- [x] Lizenz-Lookup per Key: GET /api/premium/check?licenseKey=... (22.02.2026)
- [x] Purchase-E-Mail komplett neu: Lizenz-Key prominent, Server-Zuweisungs-Anleitung (22.02.2026)
- [x] Testing: 100% (Backend 17/17, Frontend alle UI-Tests bestanden, Iteration 25)

## API Endpoints
- GET /api/health - Health + OmniFM Brand
- GET /api/bots - Bot-Status
- GET /api/stations - Stations sortiert nach Tier
- GET /api/stats - Statistiken
- GET /api/commands - Slash-Commands
- GET /api/premium/tiers - Tier-Konfiguration
- GET /api/premium/pricing - Seat-Pricing mit Upgrade-Info
- GET /api/premium/check - Server Premium-Status
- POST /api/premium/checkout - Stripe Checkout (mit seats)
- POST /api/premium/verify - Payment Verification

## Bekannte Einschraenkungen
- Discord Bot-Tokens erforderlich fuer Bot-Start
- Stripe-Integration erfordert aktive API-Keys
- SMTP erfordert konfigurierte Credentials
