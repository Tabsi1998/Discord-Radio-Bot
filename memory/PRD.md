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
│   ├── lib/db.js     # Shared MongoDB connection
│   ├── bot/runtime.js, worker-manager.js
│   ├── services/pricing.js  # Duration-based pricing
│   └── ...stores (all MongoDB)
├── update.sh         # Admin CLI (Commander/Worker mgmt)
└── web/              # Legacy static UI
```

## Pricing Model (Laufzeit-basiert)
- Free: 0 EUR
- Pro: 1M=2.99, 2M=2.79, 3M=2.49, 6M=2.29, 12M=1.99 EUR/Monat
- Ultimate: 1M=4.99, 2M=4.49, 3M=3.99, 6M=3.49, 12M=2.99 EUR/Monat

## Completed Phases
- Phase 1: Code modularization + MongoDB backend (TESTED)
- Phase 2: Commander/Worker architecture (TESTED)
- Phase 3: All 9 JSON stores → MongoDB (TESTED)
- Phase 4: Web UI redesign + Pricing migration + CLI (TESTED)

## Test Results
- iteration_1: Phase 1 PASS
- iteration_6: Phase 2 100%
- iteration_7: Design update 100%
- iteration_8: Bug fixes + Pricing migration 100% (31 tests)

## Backlog
- P1: TypeScript migration, Node.js test suite
- P2: Admin panel, Real Discord bot testing with tokens
