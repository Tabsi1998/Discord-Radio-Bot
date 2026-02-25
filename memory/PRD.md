# OmniFM v3.0 - Project Requirements Document

## Original Problem Statement
Refactoring & modernization of a Node.js Discord Radio Bot project:
- **Phase 1:** Refactor monolithic `src/index.js` into modular structure + migrate backend to MongoDB
- **Phase 2:** Re-architect bot into Commander/Worker model with tiered worker access
- **Phase 3:** Migrate all remaining JSON stores to MongoDB
- **Phase 4:** Web UI updates (Worker Dashboard) + TypeScript migration

## User Personas
- Discord server owners wanting 24/7 radio streaming
- Bot administrators managing multiple workers
- Premium users needing more simultaneous streams

## Core Requirements
1. Commander/Worker Architecture: One DJ bot handles commands, worker bots handle audio streaming
2. Tiered access: Free (2), Pro (8), Ultimate (16) workers
3. MongoDB for all data persistence
4. Modern React-based web dashboard

## Architecture
```
/app/
├── backend/          # FastAPI backend (MongoDB)
├── frontend/         # React frontend (Workers Dashboard, etc.)
├── src/              # Node.js bot (Commander/Worker architecture)
│   ├── api/          # Express.js internal API
│   ├── bot/          # BotRuntime, WorkerManager
│   ├── core/         # NetworkRecovery, Entitlements
│   ├── config/       # Plans, command permissions config
│   ├── lib/          # DB connection, logging, helpers, i18n
│   ├── services/     # Payments, streaming, now-playing
│   ├── ui/           # Embed builders
│   ├── utils/        # Command sync guard
│   ├── commands.js   # Slash command definitions (21 commands)
│   └── index.js      # Main entry (Commander + Worker init)
└── web/              # Original static web interface (legacy)
```

## What's Been Implemented

### Phase 1 (COMPLETE)
- Code modularization: 7157-line index.js → 12 modules
- Backend stations/premium data migrated to MongoDB
- Full test pass (iteration_1.json)

### Phase 2 (COMPLETE)
- Commander/Worker architecture in BotRuntime
- WorkerManager class for worker allocation
- /invite, /workers commands + /play delegation
- Command delegation for stop/pause/resume/setvolume
- Worker helper methods (playInGuild, stopInGuild, etc.)
- index.js: Commander + Worker pool initialization
- setLicenseProvider wired up for tier detection
- Fixed bugs: guildStates→guildState, setupVoiceConnectionHandlers→attachConnectionHandlers
- Fixed missing imports (REST, Routes, PermissionFlagsBits, etc.)
- Added getTierConfig/getLicense compatibility wrappers

### Phase 3 (COMPLETE - MongoDB Migration)
- `bot-state.js` → MongoDB collection `bot_state`
- `guild-language-store.js` → MongoDB collection `guild_languages`
- `song-history-store.js` → MongoDB collection `song_history`
- `custom-stations.js` → MongoDB collection `custom_stations`
- `command-permissions-store.js` → MongoDB collection `command_permissions`
- `scheduled-events-store.js` → MongoDB collection `scheduled_events`
- `coupon-store.js` → MongoDB collections `coupon_offers` + `coupon_redemptions`
- `premium-store.js` → MongoDB with in-memory cache
- `stations-store.js` → MongoDB with JSON file fallback
- Shared `src/lib/db.js` MongoDB connection module

### Phase 4 (COMPLETE - Web UI)
- React app properly enabled (was previously disabled)
- New WorkerDashboard component showing Commander/Worker system
- Tier overview cards (Free: 2, Pro: 8, Ultimate: 16)
- Workers nav link added
- New /api/workers backend endpoint
- Full test pass (iteration_6.json, 100% backend + frontend)

## Key API Endpoints
- `/api/health` - Health check
- `/api/stations` - Radio stations from MongoDB (120)
- `/api/stats` - Bot statistics
- `/api/commands` - 21 slash commands
- `/api/bots` - Bot directory
- `/api/workers` - Commander/Worker architecture status (NEW)
- `/api/premium/*` - License management

## Database Collections
### MongoDB (Backend - FastAPI)
- `stations`, `premium` (licenses), `server_entitlements`, `processed_sessions`

### MongoDB (Bot - Node.js)
- `bot_state`, `guild_languages`, `song_history`, `custom_stations`
- `command_permissions`, `scheduled_events`
- `coupon_offers`, `coupon_redemptions`
- `licenses`, `server_entitlements`, `processed_sessions`, `processed_events`, `trial_claims`

## Prioritized Backlog
### P0 - None (all critical work complete)
### P1 - Future Improvements
- TypeScript migration
- Node.js test suite
- Real Discord bot testing with tokens
### P2 - Nice to Have
- update.sh script validation
- Admin panel for worker management
