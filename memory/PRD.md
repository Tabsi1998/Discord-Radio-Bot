# Discord Radio Bot - PRD v17

## Architektur
- Node.js Bot Backend, React + FastAPI Preview, Stripe Payments, JSON-Datenbank

## Alle Features Implementiert

### Auto-Reconnect nach Restart (P0 Fix - Feb 2026)
- Event von deprecated "ready" auf "clientReady" geaendert
- 2 Sekunden Delay nach clientReady fuer Guild-Cache
- Channel wird per API geholt wenn nicht im Cache (guild.channels.fetch)
- Wartet auf VoiceConnectionStatus.Ready vor Wiedergabe
- Periodisches State-Speichern alle 60 Sekunden (Backup)
- docker-entrypoint.sh: erstellt bot-state.json, fixt Docker-Directory-Mount
- bot-state.js: Robustes Laden (leere Dateien, Verzeichnisse)
- Ausfuehrliches Logging bei jedem Restore-Schritt

### Premium System v2 - Laufzeit-basiert (Feb 2026)
- Monatliche Laufzeiten statt unbegrenzt
- Laufzeit frei waehlbar: 1, 3, 6, 12+ Monate
- Jahresrabatt: 12 Monate = 10 bezahlen (2 Monate gratis)
- Automatisches Ablaufen: isExpired(), remainingDays()
- Verlaengerung: Neue Monate werden auf bestehende Laufzeit addiert
- Upgrade Pro -> Ultimate: Nur Aufpreis fuer Restlaufzeit (Tages-Differenz)
- /api/premium/pricing: Preise, aktuelle Lizenz, Upgrade-Kosten
- /api/premium/checkout: Akzeptiert months Parameter, berechnet Preis
- /api/premium/verify: Handelt Neukauf UND Upgrade korrekt
- Frontend: Monats-Auswahl, Preisanzeige, Rabatt-Info, Lizenz-Pruefung
- Discord /premium Command: Zeigt Ablaufdatum und Resttage
- Premium CLI: Aktivieren, Verlaengern, Upgrade, Preisrechner

### Unified Management Tool (Feb 2026)
- update.sh: 6 Hauptoptionen (Update, Bots, Stripe, Premium, Settings, Status)
- Stripe Fix: docker compose up -d statt restart

### Audio Stability v4 (P1 Fix)
- Balanced Buffer, erhoehte Timeouts, Exponential Backoff

### Auto-Reconnect v2 (Voice Drop Fix)
- Race-Condition behoben, scheduleReconnect mit Dedup

## Testing
- Iteration 18: Auto-Restore + Premium 97.7% (42/43)
- Iteration 17: update.sh 100% (29/29)
- Iteration 16: Bot Stats 100% (19/19)
- Iteration 14: P0/P1 100% (40/40)

## Datenmodell premium.json
```json
{
  "licenses": {
    "GUILD_ID": {
      "tier": "pro|ultimate",
      "activatedAt": "ISO",
      "expiresAt": "ISO",
      "durationMonths": 3,
      "activatedBy": "stripe|admin-cli",
      "note": ""
    }
  }
}
```

## Backlog
- P3: Automatisierter Build (React -> Static Web)
- P4: Refactoring src/index.js in Module
