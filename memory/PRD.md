# OmniFM v3.0 - Project Requirements Document

## Original Problem Statement
Refactoring & modernization of a Node.js Discord Radio Bot:
- Phase 1: Modularize monolithic index.js + MongoDB migration
- Phase 2: Commander/Worker architecture with tiered workers
- Phase 3: All JSON stores to MongoDB + pricing migration
- Phase 4: Web UI redesign + update.sh CLI expansion

## Architecture
```
/app/
├── backend/          # FastAPI (MongoDB, pricing API)
├── frontend/         # React (redesigned dashboard)
├── src/              # Node.js bot (Commander/Worker)
│   ├── lib/          # logging.js, helpers.js, db.js etc.
│   ├── bot/          # runtime.js, worker-manager.js
│   ├── services/     # stream.js, now-playing.js, pricing.js
│   └── core/         # network-recovery.js, entitlements.js
├── update.sh         # Admin CLI (Commander/Worker mgmt)
└── web/              # Legacy static UI
```

## Pricing Model
- Durations: 1, 3, 6, 12 months
- Server counts: 1, 2, 3, 5 servers per license
- Pro: 1S=2.99, 2S=5.49, 3S=7.49, 5S=11.49 EUR/mo (1mo base)
- Ultimate: 1S=4.99, 2S=9.19, 3S=12.49, 5S=19.19 EUR/mo (1mo base)
- Duration discounts applied proportionally

## Worker-Bot Tiers
- Free: Bot 1-2 (via Commander invite on website)
- Pro: Bot 3-8 (via /invite command in Discord)
- Ultimate: Bot 9-16 (via /invite command in Discord)

## Completed Work
- Phase 1: Code modularization + MongoDB backend
- Phase 2: Commander/Worker architecture
- Phase 3: All 9 JSON stores -> MongoDB
- Phase 4: Web UI redesign + Pricing migration + CLI

## Bug Fixes (2026-02-25)
- FIXED: Import crash in src/core/network-recovery.js (./logging.js -> ../lib/logging.js)
- FIXED: Import crash in src/services/now-playing.js (./logging.js -> ../lib/logging.js)
- FIXED: Import crash in src/services/stream.js (shouldLogFfmpegStderrLine from ../lib/logging.js)
- FIXED: All src/ files verified - zero broken imports remaining
- FIXED: Checkout popup rebuilt as modal with Anzahl Server (1,2,3,5) + Laufzeit (1,3,6,12)
- FIXED: Laufzeit-Preise box removed from plan card overview
- FIXED: Commands tiers collapsed by default
- FIXED: BotDirectory shows only Commander + Worker-Tiers info panel
- FIXED: Footer z-index blocking modal Abbrechen button

## Test Results
- iteration_9: P0+P1 initial fix 100%
- iteration_10: Checkout modal 100%
- iteration_11: Full feature set 93% (z-index bug found + fixed)

## Backlog
- P2: Full testing of update.sh CLI with Commander/Worker management
- P1: TypeScript migration, Node.js test suite
- P2: Admin panel, Real Discord bot testing with tokens
