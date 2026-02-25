# OmniFM v3.0 - Project Requirements Document

## Original Problem Statement
Vollständige Analyse des GitHub-Repositories "Discord-Radio-Bot" (OmniFM v3.0) und Live-Preview im Emergent-Environment.

## Projekt-Übersicht
**OmniFM v3.0** ist ein professioneller 24/7 Discord Radio Streaming Bot mit einem 3-Tier Premium-System und seat-basierter Lizenzierung.

## Tech Stack
- **Runtime:** Node.js 20 (ES Modules), discord.js v14.17.3
- **Audio:** @discordjs/voice v0.18.0, FFmpeg
- **Payment:** Stripe v17.0.0
- **Email:** Nodemailer v8.0.1
- **Deployment:** Docker
- **Datenbank:** JSON-Datei-basiert
- **Emergent Backend:** FastAPI (Python)
- **Web Frontend:** Vanilla HTML/CSS/JS

## Kernfunktionalitäten
1. Multi-Bot System (bis 20 Bots)
2. 3-Tier Premium (Free/Pro/Ultimate)
3. 21 Discord Slash Commands (/play, /event, /license, /perm, etc.)
4. FFmpeg Audio-Streaming mit Netzwerk-Recovery
5. Event Scheduler (täglich/wöchentlich/monatlich)
6. Stripe Payment + Coupon/Referral System
7. Email-Benachrichtigungen
8. i18n (DE/EN)
9. Song History + Now-Playing mit Album-Cover

## Was wurde implementiert
- [2026-02-25] Repo geklont (neueste Version verifiziert)
- [2026-02-25] Original web/ Interface 1:1 im Preview lauffähig
- [2026-02-25] /api/commands aktualisiert: alle 21 Commands inkl. /help, /history, /diag, /language, /event, /license, /perm
- [2026-02-25] Vollständige Codebase-Analyse abgeschlossen

## Backlog
- P1: Optimierungsplan mit User erstellen
- P2: Implementierung vereinbarter Änderungen
