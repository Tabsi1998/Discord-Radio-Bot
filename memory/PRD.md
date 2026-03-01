# PRD – Discord-Radio-Bot (P1→P2→P3 Umsetzung)

## Original Problem Statement (fortlaufend)
User wollte nach Vollanalyse die Umsetzung in Reihenfolge **P1 dann P2 dann P3**:
- **Pro**: server-spezifische Basis-Stats (GUID intern), Rollenrechte pro Command
- **Ultimate**: YouTube-Livestream-Playback, priorisierte Worker-Zuteilung, erweiterte Analytics (pro Server/Channel + Tagesreport)
- **Ultimate Reliability Mode**: optionaler Fallback in `/play` mit zwei Stationen
- Datenschutz: **keine öffentlichen Top-Server/Top-Station/Peak-Daten auf der Webseite**

## Architektur-/Produktentscheidungen
- Node-Bot bleibt funktionale Referenz für Discord-Command-Features.
- Stats-Ausgabe bleibt server-spezifisch im Discord-Kontext; keine globale Public-Leaderboard-Ausgabe in Stats-Embeds.
- `/play` erhält optionales `fallback`-Argument, aktiv nur für Ultimate.
- YouTube-Live wird nur im Ultimate-Flow akzeptiert.

## Implementiert
1. **P1 (Pro-Bereich)**
- `/stats` tier-sensitiv gemacht: Free blockiert, Pro zeigt Basis-Stats, Ultimate erweitert.
- Rollenrechte-Feature bleibt aktiv über bestehendes `/perm` (Pro+).
- Listening-Stats-Store erweitert (u. a. Daily Buckets, Peak-Metriken je Station/Channel, Listener-Sample-Aggregate).

2. **P2 (Ultimate Core)**
- `/play` erweitert um Option `fallback` (Command-Definition + Runtime + Autocomplete).
- Ultimate-only YouTube-Live-Eingaben in `/play` akzeptiert.
- Stream-Service erweitert: YouTube-URL-Auflösung via `yt-dlp` Resolver vor ffmpeg/fetch.
- Worker-Priorisierung verbessert: bei Ultimate wird freier Worker nach Last (aktive Streams/Guild-Load) bevorzugt.

3. **P3 (Ultimate Reliability + Analytics)**
- Manueller Fallback wird im Runtime-State gespeichert und bei Start-/Restart-Fehlern priorisiert verwendet.
- Erweiterte Ultimate-Analytics im `/stats`-Embed:
  - Top Voice-Channels
  - Stationen nach Listener-Peaks
  - 7-Tage-Report
  - Top Commands
- Privacy-Anforderung umgesetzt: keine globale Top-Server-Ausgabe im Stats-Embed.

4. **Backend API/Preview-Angleichung**
- FastAPI `/api/commands` aktualisiert:
  - `/play` zeigt fallback/Ultimate-YouTube-Hinweis
  - `/stats` Eintrag ergänzt (Pro+/Ultimate Analytics)

## Verifikation
- JS-Lint: grün
- Python-Lint: grün
- Node Tests: **31/31 passed**
- Backend Tests (Repo): **19 passed**
- Testing-Agent Regression (Iteration 6): Kernchecks erfolgreich, keine reproduzierten Produkt-Regressions im Scope
- Preview Smoke: Homepage lädt, API-Kommandoliste reflektiert neue Contracts

## Priorisierter Backlog
### P0 (offen aus Hardening)
- Legacy-Backend-Testdateien ohne Public-URL-Default bereinigen (Skip-Technical-Debt reduzieren)

### P1
- Runtime-Modularisierung (`runtime.js` in Analytics/Playback/Commands splitten)
- Optional: Feature-Flags zentralisieren (YouTube/Fallback/Analytics)

### P2
- Echte Discord-E2E-Abnahme (Guild mit Live-Tokens):
  - `/play ... fallback:...`
  - Ultimate YouTube-Live in realer Voice-Session
  - Failover-Verhalten unter Last

## Next Tasks
1. Wenn gewünscht: sofortiges Refactoring-Paket für `runtime.js` + zusätzliche Contract-Tests.
2. Danach Discord-E2E-Härtung mit realer Guild/Test-Server.
