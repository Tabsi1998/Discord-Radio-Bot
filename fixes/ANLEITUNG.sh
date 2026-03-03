# Auf deinem Server ausfuehren:
# ================================

cd /opt/Discord-Radio-Bot

# 1. Alte Muell-Dateien loeschen
rm -rf fixes/ apply-fixes.sh
rm -f *.bak src/*.bak src/bot/*.bak
rm -rf .backup-*

# 2. Die 6 geaenderten Dateien ersetzen (aus dem Emergent Download)
# cp <pfad-zum-download>/Dockerfile ./Dockerfile
# cp <pfad-zum-download>/package.json ./package.json
# cp <pfad-zum-download>/docker-entrypoint.sh ./docker-entrypoint.sh
# cp <pfad-zum-download>/src/index.js ./src/index.js
# cp <pfad-zum-download>/src/guild-language-store.js ./src/guild-language-store.js
# cp <pfad-zum-download>/src/bot/runtime.js ./src/bot/runtime.js

# 3. Verifizieren
head -3 Dockerfile          # Sollte: FROM node:22-slim
grep snazzah package.json   # Sollte: @snazzah/davey
grep MessageFlags src/bot/runtime.js | wc -l  # Sollte: ~170

# 4. Korrupte JSONs reparieren
echo '{}' > command-permissions.json
echo '{}' > coupons.json

# 5. Docker neu bauen + starten
docker compose build --no-cache
docker compose up -d
docker compose logs -f omnifm

# Im Log sollte jetzt erscheinen:
# - "Voice-Dependencies:" Report
# - "VoiceState: signalling -> connecting -> ready" (bei /play)
# - KEIN "ephemeral" Warning mehr
