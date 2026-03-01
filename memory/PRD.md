# PRD – Repo Vollanalyse: Discord-Radio-Bot

## Original Problem Statement
"Hol dir bitte das angegebene Github Repossitory KOMPLETT sauber runter und ANALYSIERE es komplett udn nimme s im preview in betrieb und alles! dass wir usn gemeinsam anschauen was man noch verbessern udn obtimieren kann oder wo es noch punkte giebt oder geben könnte! Analysiere ob wie eo was fehlt usw usw. also alles einmal! https://github.com/Tabsi1998/Discord-Radio-Bot"

## Architecture Decisions
- Analyse auf `main`-Branch durchgeführt.
- Vollscan über Node-Core (`src/`), React-Frontend (`frontend/`), FastAPI (`backend/`), Docker + Skripte.
- Preview-Betrieb über laufende Frontend/Backend-Services aktiviert.
- Qualitätssignale aus Tests, Lint, Build, API-Smoke, Browser-Konsole zusammengeführt.

## Was umgesetzt wurde
- Repo geklont und lauffähig geprüft.
- Preview-URL erfolgreich gestartet und visuell verifiziert.
- Node-Tests ausgeführt (31/31 passed).
- FastAPI-Tests gegen laufende API ausgeführt (11 passed, 2 failed).
- API-Endpunkt-Matrix Node vs FastAPI erstellt (Drift identifiziert).
- Sicherheits-/Dependenz-Check (`npm audit`) durchgeführt.
- Vollständiger Analysebericht erstellt: `/app/Discord-Radio-Bot/ANALYSE_REPORT.md`.

## Priorisierter Backlog
### P0
- API-Contract zwischen Node und FastAPI harmonisieren.
- Fehlende FastAPI-Endpunkte ergänzen (`/api/legal`, `/api/privacy`, Trial/Offers/DBL-Status).
- Pricing-Datenformat robust machen (locale-safe numerische Verarbeitung).
- Test-Fails beheben (`workers.botId`, `pricing.trial`).

### P1
- `.gitignore` hinzufügen.
- CI-Workflow für lint/test/smoke einführen.
- Große Dateien modulweise aufsplitten (runtime/api/premium/frontend premium).

### P2
- Legacy-Webpfad (`web/`) mit React vereinheitlichen oder entfernen.
- Dependency-Audit-Fixes mit Regressionstests.
- Frontend-Konsole-Warnungen (Animation-Styles) bereinigen.

## Next Tasks
1. P0 API-Drift-Fixes umsetzen und E2E erneut testen.
2. Danach CI + `.gitignore` einführen.
3. Anschließend Refactoring-Paket für große Dateien planen.
