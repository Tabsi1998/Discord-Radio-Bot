#!/usr/bin/env sh
set -e

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

if [ "${REGISTER_COMMANDS_ON_BOOT:-1}" = "1" ]; then
  node /app/src/deploy-commands.js
fi

exec node /app/src/index.js
