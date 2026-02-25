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
│   ├── core/         # network-recovery.js, entitlements.js
│   ├── ui/           # upgradeEmbeds.js
│   ├── discord/      # syncGuildCommandsSafe.js
│   └── utils/        # commandSyncGuard.js
├── update.sh         # Admin CLI (Commander/Worker mgmt)
└── web/              # Legacy static UI
```

## Pricing Model
- Durations: 1, 3, 6, 12 months
- Server counts: 1, 2, 3, 5 servers per license
- Pro: 1S=2.99, 2S=5.49, 3S=7.49, 5S=11.49 EUR/mo
- Ultimate: 1S=4.99, 2S=9.19, 3S=12.49, 5S=19.19 EUR/mo

## Worker-Bot Tiers
- Free: Bot 1-2 (Commander invite on website)
- Pro: Bot 3-8 (via /invite command)
- Ultimate: Bot 9-16 (via /invite command)

## Bug Fixes (2026-02-25)
- FIXED: network-recovery.js (./logging.js -> ../lib/logging.js)
- FIXED: now-playing.js (./logging.js -> ../lib/logging.js)
- FIXED: stream.js (shouldLogFfmpegStderrLine from logging.js not helpers.js)
- FIXED: runtime.js (removed nonexistent buildUpgradeEmbed, getDiscordLocale, commandSyncGuard imports)
- FIXED: Added normalizeSeats + PRO_TRIAL_SEATS to helpers.js (used by payment.js, api-helpers.js)
- FIXED: Updated DURATION_OPTIONS to [1,3,6,12] in helpers.js
- VERIFIED: ALL src/ imports validated - zero issues

## Test Results
- iteration_11: Full feature set (z-index fixed)
- Post-fix validation: ALL files pass node --check, ALL imports verified

## Backlog
- P2: Full testing of update.sh CLI
- P1: TypeScript migration, Node.js test suite
- P2: Admin panel, Discord bot testing with tokens
