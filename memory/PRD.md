# OmniFM v3.0 - Project Requirements Document

## Original Problem Statement
Refactoring & modernization of a Node.js Discord Radio Bot project:
- **Phase 1:** Refactor monolithic `src/index.js` into modular structure + migrate backend to MongoDB
- **Phase 2:** Re-architect bot into Commander/Worker model with tiered worker access
- **Phase 3:** Migrate all remaining JSON stores to MongoDB
- **Phase 4:** Web UI updates (Worker Dashboard, Design Redesign)

## User Personas
- Discord server owners wanting 24/7 radio streaming
- Bot administrators managing multiple workers
- Premium users needing more simultaneous streams

## Architecture
```
/app/
├── backend/          # FastAPI backend (MongoDB)
├── frontend/         # React frontend (redesigned)
│   └── src/components/
│       ├── Hero.js             # Equalizer, glow effects, CTAs
│       ├── Features.js         # How it works (3 steps) + feature grid
│       ├── WorkerDashboard.js  # Commander/Worker status
│       ├── BotDirectory.js     # Bot cards
│       ├── StationBrowser.js   # Station browser
│       ├── Commands.js         # Tier-sorted commands
│       ├── Premium.js          # Plan cards with BELIEBT badge
│       └── Navbar.js           # Updated navigation
├── src/              # Node.js bot (Commander/Worker)
│   ├── lib/db.js     # Shared MongoDB connection
│   ├── bot/runtime.js # BotRuntime (commander/worker roles)
│   ├── bot/worker-manager.js
│   └── ...stores (all MongoDB)
└── web/              # Legacy static UI
```

## What's Been Implemented

### Phase 1 (COMPLETE) - Feb 2026
- Code modularization: 7157-line index.js → 12 modules
- Backend stations/premium data migrated to MongoDB

### Phase 2 (COMPLETE) - Feb 2026
- Commander/Worker architecture
- WorkerManager, /invite, /workers commands
- Tier-based worker access (Free:2, Pro:8, Ultimate:16)

### Phase 3 (COMPLETE) - Feb 2026
- All 9 JSON stores migrated to MongoDB
- Shared db.js connection module

### Phase 4 (COMPLETE) - Feb 2026
- Worker Dashboard with Commander/Worker visualization
- Homepage redesign: equalizer hero, "So funktioniert's", tier-sorted commands
- Commands sorted by Free(16)/Pro(4)/Ultimate(3)
- Premium plan cards with BELIEBT badge
- Fixed critical helpers.js SyntaxError (const inside export block)
- All 23 slash commands in API

## Test Results
- iteration_1.json: Phase 1 - PASS
- iteration_6.json: Phase 2 - 100% backend/frontend
- iteration_7.json: Phase 4 design update - 100% (28 tests passed, 0 failures)

## Key API Endpoints
- `/api/health`, `/api/stations` (120), `/api/stats`, `/api/commands` (23)
- `/api/bots`, `/api/workers` (commander/worker), `/api/premium/*`

## Prioritized Backlog
### P1
- TypeScript migration
- Node.js test suite
- Real Discord bot testing with tokens
### P2
- Admin panel for worker management
- update.sh script validation
