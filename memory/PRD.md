# OmniFM v3.0 - Project Requirements Document

## Original Problem Statement
1. Vollständige Analyse des GitHub-Repositories "Discord-Radio-Bot" (OmniFM v3.0)
2. src/index.js Aufspaltung (7157 Zeilen → modulare Architektur)
3. MongoDB-Migration für Backend
4. Commander/Worker Bot-Architektur (Phase 2)

## Tech Stack
- **Runtime:** Node.js 20 (ES Modules), discord.js v14.17.3
- **Audio:** @discordjs/voice, FFmpeg
- **Payment:** Stripe v17.0.0
- **Email:** Nodemailer v8.0.1
- **Deployment:** Docker
- **Datenbank:** JSON (Bot) + MongoDB (Backend API)
- **Backend API:** FastAPI (Python)
- **Web Frontend:** Vanilla HTML/CSS/JS

## Modulare Architektur (Phase 1 abgeschlossen)

### src/ Struktur nach Aufspaltung:
```
src/
├── index.js                  (239 Zeilen, war: 7157)
├── bot/runtime.js            (3566 Zeilen, BotRuntime Klasse)
├── api/server.js             (1042 Zeilen, Web-Server + Routes)
├── lib/
│   ├── api-helpers.js        (579 Zeilen, HTTP/CORS/Auth)
│   ├── helpers.js            (369 Zeilen, Utilities)
│   ├── event-time.js         (408 Zeilen, Event-Scheduling)
│   ├── logging.js            (138 Zeilen, Logging-System)
│   └── language.js           (90 Zeilen, i18n Helfer)
├── services/
│   ├── payment.js            (657 Zeilen, Stripe/Email)
│   ├── now-playing.js        (245 Zeilen, ICY Metadata)
│   └── stream.js             (150 Zeilen, Audio-Stream)
├── core/
│   ├── entitlements.js       (bestehend)
│   └── network-recovery.js   (69 Zeilen, Netzwerk-Recovery)
├── config/plans.js           (bestehend)
├── ...stores                 (bestehend, unverändert)
```

### MongoDB Migration:
- Stationen aus stations.json → MongoDB `stations` Collection (120 Einträge)
- Premium-Daten → MongoDB `licenses`, `server_entitlements`, `processed_sessions`
- Fallback auf JSON wenn MongoDB nicht verfügbar

## Was wurde implementiert
- [2026-02-25] Repo analysiert und Preview lauffähig gemacht
- [2026-02-25] /api/commands: 21 Commands (inkl. /help, /event, /license, /perm)
- [2026-02-25] Phase 1: index.js von 7157 → 239 Zeilen (12 Module)
- [2026-02-25] Phase 1: MongoDB-Migration für Backend
- [2026-02-25] Tests: 100% bestanden (Backend 15/15 + Frontend 100%)

## Phase 2: Commander/Worker Architektur (nächster Schritt)
- OmniFM DJ = Commander Bot (Slash Commands, Management)
- OmniFM 1-16 = Worker Bots (Audio-Streaming)
- Automatische Worker-Zuweisung
- DJ lädt Worker per /command ein (basierend auf Tier)
- Worker zeigen Now-Playing Embeds
- Tier: Free=DJ+Worker 1-2, Pro=DJ+Worker 1-8, Ultimate=DJ+Worker 1-16
- Events: DJ weist automatisch freien Worker zu

## Backlog
- P0: Phase 2 Commander/Worker Architektur
- P1: Test-Suite für Node.js Bot
- P2: TypeScript Migration
