#!/usr/bin/env sh
set -e

if [ -n "${DISCORD_TOKEN}" ] && [ -n "${CLIENT_ID}" ] && [ -n "${GUILD_ID}" ]; then
  node /app/src/deploy-commands.js
else
  echo "WARN: DISCORD_TOKEN/CLIENT_ID/GUILD_ID fehlen. Slash-Commands werden nicht registriert."
fi

node /app/src/index.js
