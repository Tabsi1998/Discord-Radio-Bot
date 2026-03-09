# OmniFM Local Development

## Goal

Run the bot, API, and website locally for development and testing.

## Minimum setup

Create `.env` from `.env.example` and fill at least:

- `BOT_1_TOKEN`
- `BOT_1_CLIENT_ID`

Recommended local defaults:

- `PUBLIC_WEB_URL=http://localhost:8081`
- `WEB_PORT=8081`
- `WEB_INTERNAL_PORT=8080`
- `MONGO_ENABLED=0`

## Full dashboard login setup

If you also want to test Discord OAuth for the dashboard, add:

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI=http://localhost:8081/api/auth/discord/callback`

Your Discord application must allow that redirect URI.

## Start commands

Install dependencies once:

```bash
npm install
npm --prefix frontend install
```

Terminal 1: bot + API + integrated website

```bash
npm start
```

Terminal 2: optional frontend hot reload

```bash
npm run frontend:start
```

## Local URLs

- Integrated site from the Node backend: `http://localhost:8081`
- API health check: `http://localhost:8081/api/health`
- React dev server with hot reload: `http://localhost:3000`

When the React dev server runs on `localhost:3000`, it automatically targets the backend at `localhost:8081`.

## What works without extra services

- public website
- station directory
- pricing display
- most public API routes
- bot presence and runtime, if a valid Discord bot token is configured

## What needs more environment variables

- Dashboard Discord login: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`
- Stripe checkout: Stripe keys and webhook secret
- SMTP mail: SMTP host and credentials
- Mongo-backed persistence: `MONGO_URL` or `MONGO_ENABLED=1`

## Common local blockers

- Empty `.env`: OmniFM exits because no bot config can be loaded.
- Missing `ffmpeg`: the process can start, but actual audio streaming features are limited or unavailable.
- Missing OAuth redirect setup in Discord: dashboard login fails even if the website itself loads.
