# PRD – Discord-Radio-Bot (P0 Umsetzung)

## Original Problem Statement
- Repo komplett sauber klonen, vollständig analysieren, im Preview starten und konkrete Optimierungen umsetzen.
- Follow-up User Choice: **erst P0 umsetzen**, danach Review.
- API-Referenzentscheidung: **Node-API ist Source of Truth**, FastAPI wurde angeglichen.

## Architektur-Entscheidung
- Bestehende Dual-Architektur (Node + FastAPI) bleibt vorerst bestehen.
- Für P0 wurde FastAPI-Contract an Node angeglichen, damit Frontend- und API-Flows konsistent sind.

## Umgesetzt (P0)
- FastAPI ergänzt: `/api/legal`, `/api/privacy`, `/api/premium/trial`, `/api/premium/offer`, `/api/premium/offer/preview`, `/api/premium/offers`, `/api/premium/offers/active`, `/api/premium/redemptions`, `/api/discordbotlist/status`.
- Contract-Fixes: `/api/workers` enthält jetzt `botId`; `/api/premium/pricing` enthält `trial` und vollständigen Lizenz-Upgrade-Kontext.
- Premium-Flow: Trial-Claim-Logik (einmal pro E-Mail), Offer-Preview/Offer-CRUD (admin-geschützt), Admin-Guard-Responses harmonisiert.
- Frontend robust gemacht: Preisparser unterstützt Komma/ Punkt (`startingAt`), Hero-Animation-Warnung bereinigt, Abort-Fehlerlogging in App entschärft.
- Verifikation: Backend-Tests grün (**19 passed** im Repo-Backend), Node-Tests grün (**31 passed**), Frontend Build grün, Imprint/Privacy/Trial im Preview geprüft.

## Priorisierter Backlog
### P1 (kurzfristig)
- `.gitignore` ergänzen
- CI-Pipeline (lint + tests + smoke)
- `backend/server.py` und große Frontend-Komponenten modular aufteilen

### P2 (mittelfristig)
- Legacy `web/` Pfad strategisch vereinheitlichen/abbauen
- Security-Dependency-Updates mit Regressionstest
- Weitere API-Parität für seltene Admin/Sync-Routen vollständig abschließen

## Nächste Tasks
1. P1: CI + `.gitignore` sofort nachziehen.
2. P1: Server in Router/Services aufteilen (Legal, Privacy, Premium, Offers, DBL).
3. P2: Node/FastAPI Drift dauerhaft minimieren (gemeinsame Contracts/Schemas).
