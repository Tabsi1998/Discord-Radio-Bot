# OmniFM - Product Requirements Document v3.2

## Produkt
OmniFM - 24/7 Discord Radio Streaming Bot mit Premium Tier-System und Seat-basierter Lizenzierung.

## Architektur
- **Backend (Bot)**: Node.js, discord.js, Express.js (`/app/src/index.js`)
- **Backend (API)**: Python FastAPI (`/app/backend/server.py`)
- **Frontend (React)**: React (`/app/frontend/src/`) - Emergent Preview
- **Frontend (Static)**: HTML/CSS/JS (`/app/web/`) - Produktions-Docker
- **State**: Flat-file JSON (`premium.json`, `bot-state.json`, `stations.json`)
- **Payment**: Stripe Checkout (One-time, E-Mail-basiert)
- **Email**: Nodemailer (SMTP) fuer Lizenz-Key Versand

## Plan-System (3 Tiers)

| Feature | Free | Pro | Ultimate |
|---------|------|-----|----------|
| Max Bots | 2 | 8 | 16 |
| Bitrate | 64k | 128k Opus | 320k Opus |
| Stationen | 20 Free | 20 Free + 100 Pro | Alle + Custom URLs |
| Custom URLs | - | - | 50 pro Server |

## Seat-basierte Lizenzierung
- 1, 2, 3 oder 5 Server pro Lizenz
- E-Mail-basierter Checkout: Lizenz-Key per E-Mail
- /license activate im Discord zum Verknuepfen

## Stationen (v3.2 - 120 Total)
- **20 Free**: Groove Salad, Drone Zone, Deep Space One, etc.
- **100 Pro**: EDM (16), Tomorrowland (3), Sunshine Live (1), Techno (20), Trance (10), Hardstyle (10), House (15), Urban (15), Rock (10)

## API Endpoints
- GET /api/health, /api/bots, /api/stations, /api/stats, /api/commands
- GET /api/premium/tiers, /api/premium/pricing, /api/premium/check
- POST /api/premium/checkout (email-basiert), /api/premium/verify

## Bekannte Einschraenkungen
- Discord Bot-Tokens erforderlich
- Stripe API-Keys erforderlich
- SMTP Credentials fuer E-Mail-Versand
