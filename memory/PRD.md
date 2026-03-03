# PRD - OmniFM Discord Radio Bot

## Problem
/play Voice-Verbindung Timeout seit Discord DAVE E2EE Pflicht (01.03.2026)

## Fixes (6 Dateien)
- Dockerfile: node:22 + libsodium-dev
- package.json: discord.js 14.25.1, @discordjs/voice 0.19.0, @snazzah/davey, sodium-native, libsodium-wrappers, dotenv 17.3.1, stripe 20.4.0
- src/bot/runtime.js: Custom voiceAdapterCreator mit sendPayload-Logging, configureNetworking() Workaround, Voice Debug-Logging, 133x ephemeral->MessageFlags, album Bug fix, Timeout 30s, Auto-Reconnect
- src/index.js: Voice-Dependency-Report beim Start
- src/guild-language-store.js: Auto-Repair bei korrupter JSON
- docker-entrypoint.sh: JSON-Validierung beim Container-Start
