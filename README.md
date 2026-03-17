# OmniFM v3

Node.js (`src/api/server.js`) is the canonical production backend. The Python implementation in `backend/server.py` remains in the repository only as a legacy/reference path and is feature-frozen.

OmniFM is a 24/7 Discord radio bot stack with commander/worker routing, Premium licensing, scheduled events, live now-playing embeds, server statistics, DiscordBotList sync, Top.gg sync, discord.bots.gg stats sync, and optional audio fingerprint fallback for weak station metadata.

## What it does

- Streams radio stations into Discord voice and stage channels
- Uses one commander bot for slash commands and multiple worker bots for playback
- Supports Free, Pro, and Ultimate plans with seat-based licensing
- Lets server admins manage subscription email, renewals, and coupon-aware upgrade previews in the dashboard
- Shows replay-protected billing activity and recent subscription processing status directly in the dashboard
- Provides `/now`, `/history`, `/stats`, `/workers`, `/invite`, `/event`, `/premium`, and more
- Publishes cleaner now-playing embeds with cover art and search buttons
- Falls back to audio fingerprint recognition when stations provide bad or missing metadata
- Syncs bot stats, commands, and vote webhooks with DiscordBotList
- Syncs Top.gg project details, commands, stats, votes, and vote webhooks separately
- Syncs discord.bots.gg stats separately from the other bot-list providers
- Stores normalized vote events across providers as groundwork for future shared vote rewards
- Serves bilingual imprint, privacy, and terms pages for the website footer

## Requirements

- Docker with `docker compose`
- Linux host recommended for production
- Discord bot tokens and client IDs
- Optional:
  - Stripe keys for Premium checkout
  - SMTP credentials for license and invoice mail
  - DiscordBotList token and webhook secret
  - Top.gg token and optional webhook secret
  - discord.bots.gg token
  - AcoustID API key for audio fingerprint fallback

## Quick start

```bash
./install.sh
```

The installer can configure:

- Discord bot accounts
- Web port and public URL
- Stripe
- DiscordBotList
- Optional AcoustID/MusicBrainz recognition fallback

The interactive scripts now also cover:

- Stripe API keys
- DiscordBotList token, webhook secret, and stats scope
- Top.gg token, bot ID, webhook secret, and sync intervals
- discord.bots.gg token, bot ID, and stats scope
- SMTP credentials
- AcoustID recognition settings
- Default language fallback via `DEFAULT_LANGUAGE` (`en` recommended)
- Imprint, privacy, and terms details for Austrian legal pages

After installation:

```bash
docker compose up -d --build
docker compose logs -f omnifm
```

The production path uses the Node app started from `src/index.js`. `backend/` is not part of the primary install, run, or test flow anymore.

## First run in Discord

For the first successful stream on a real server, the clean flow is:

1. Invite the commander bot
2. Use `/workers` or `/invite` to check and add at least one worker
3. Run `/play` in your voice or stage channel

The commander handles commands. Workers carry the actual audio streams.

## Daily management

```bash
./update.sh
./update.sh --bots
./update.sh --settings
./update.sh --settings commands
./update.sh --stripe
./update.sh --premium
./update.sh --offers
./update.sh --email
./update.sh --status
./update.sh --status quick
./update.sh --cleanup
```

`./update.sh --settings commands` opens the slash-command and sync configuration directly. `./update.sh --status` opens the interactive admin cockpit for runtime status, API health, Docker logs, local rotated logs, MongoDB status, storage checks, container rebuilds, slash-command deploys, premium/offers actions, SMTP setup, and quick jumps back into settings or bot management. `./update.sh --offers` opens the offer manager for discount, referral, and direct free-license codes.

## Website legal pages

OmniFM now exposes three footer-linked legal pages on the production website:

- `Impressum / Imprint`
- `Datenschutzerklärung / Privacy policy`
- `Nutzungsbedingungen / Terms of service`

All three pages are bilingual and use the same locale handling as the rest of the React frontend.

### Configure them

Open:

```bash
./update.sh --settings
```

Then choose:

```text
8) Impressum, Datenschutz & Terms
```

### Required imprint details

These fields should be filled before using the website in production:

- `LEGAL_PROVIDER_NAME`
- `LEGAL_STREET_ADDRESS`
- `LEGAL_POSTAL_CODE`
- `LEGAL_CITY`
- `LEGAL_EMAIL`

### Optional or case-dependent imprint details

These depend on your legal form, company structure, trade license, or media-law setup:

- `LEGAL_LEGAL_FORM`
- `LEGAL_REPRESENTATIVE`
- `LEGAL_PHONE`
- `LEGAL_WEBSITE`
- `LEGAL_BUSINESS_PURPOSE`
- `LEGAL_COMMERCIAL_REGISTER_NUMBER`
- `LEGAL_COMMERCIAL_REGISTER_COURT`
- `LEGAL_VAT_ID`
- `LEGAL_SUPERVISORY_AUTHORITY`
- `LEGAL_CHAMBER`
- `LEGAL_PROFESSION`
- `LEGAL_PROFESSION_RULES`
- `LEGAL_EDITORIAL_RESPONSIBLE`
- `LEGAL_MEDIA_OWNER`
- `LEGAL_MEDIA_LINE`

### Privacy details

The privacy page automatically reuses the controller name, address, and primary contact data from the imprint. These privacy-specific fields are additionally available in the same menu:

- `PRIVACY_CONTACT_EMAIL`
- `PRIVACY_CONTACT_PHONE`
- `PRIVACY_DPO_NAME`
- `PRIVACY_DPO_EMAIL`
- `PRIVACY_HOSTING_PROVIDER`
- `PRIVACY_HOSTING_LOCATION`
- `PRIVACY_ADDITIONAL_RECIPIENTS`
- `PRIVACY_CUSTOM_NOTE`
- `PRIVACY_AUTHORITY_NAME`
- `PRIVACY_AUTHORITY_WEBSITE`

Recommended minimum for the privacy page:

- a valid privacy contact email
- the hosting provider or infrastructure label
- the hosting location or region

If privacy-specific fields are omitted, OmniFM falls back to the imprint data where possible and visibly marks missing details on the legal pages.

### Terms details

The terms page reuses the operator details from the imprint and exposes a dedicated service/contact block for Discord verification and support links. These fields are additionally available in the same menu:

- `TERMS_CONTACT_EMAIL`
- `TERMS_SUPPORT_URL`
- `TERMS_EFFECTIVE_DATE`
- `TERMS_GOVERNING_LAW`
- `TERMS_CUSTOM_NOTE`

Recommended minimum for the terms page:

- a valid support or contact email
- a public support or website URL
- an effective date
- a governing-law statement

The website supports both query-style links and clean localized paths:

- `/?page=imprint` and `/imprint`
- `/?page=privacy` and `/privacy`
- `/?page=terms` and `/terms`
- German equivalents `/impressum`, `/datenschutz`, `/nutzungsbedingungen`

The terms page includes an explicit notice that terms of service do not resolve any copyright or licensing obligations for radio streams or user-provided stream URLs.

Public API payloads for the legal pages are available at:

- `/api/legal`
- `/api/privacy`
- `/api/terms`

## Architecture

### Commander and workers

- The commander bot registers slash commands and answers interactions.
- Worker bots join voice channels and handle the actual audio stream.
- `/play` is routed to an already active worker in the same voice channel whenever possible.
- Premium limits are enforced by worker slot, not raw `BOT_N` index.

### Slash command registration

- Default is `COMMAND_REGISTRATION_MODE=guild`.
- `guild` keeps command rollout fast and predictable, which fits the commander/worker setup best.
- `global` registers commands only globally for the commander and skips guild sync.
- `hybrid` does both: global commander commands plus guild sync for faster rollout in joined servers.
- Worker bots should not expose slash commands because only the commander handles interactions.

### Runtime flow

1. User runs a slash command on the commander.
2. Commander validates permissions, tier, and worker availability.
3. A worker joins the target voice channel.
4. FFmpeg transcodes the station stream to Discord-friendly audio.
5. OmniFM updates the now-playing embed, song history, and listening stats.

## Track metadata and cover art

OmniFM resolves track data in this order:

1. ICY metadata from the radio stream
2. Cover lookup from iTunes, MusicBrainz/Cover Art Archive, and Discogs
3. Optional audio fingerprint fallback if the stream metadata is missing, incomplete, or noisy

### Audio fingerprint fallback

If enabled, OmniFM samples the live stream, fingerprints the audio with `fpcalc` (Chromaprint), looks up the match on AcoustID, and enriches the result with MusicBrainz and Cover Art Archive.

Flow:

1. FFmpeg records a short mono WAV sample from the station URL
2. `fpcalc` creates the Chromaprint fingerprint
3. AcoustID matches the fingerprint
4. MusicBrainz enriches artist, title, album, and release IDs
5. Cover Art Archive is used for album art if available

Important:

- The free AcoustID web service is documented as non-commercial only.
- OmniFM includes Premium and commercial-style billing features.
- Because of that, fingerprint recognition is disabled by default and must be enabled explicitly.
- You are responsible for using AcoustID in a way that matches their terms.

Relevant official docs:

- AcoustID web service: <https://acoustid.org/webservice>
- AcoustID API client docs: <https://acoustid.org/webservice#lookup>
- MusicBrainz API rate limiting: <https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting>
- Chromaprint project: <https://github.com/acoustid/chromaprint>

### Chromaprint installation in Docker

OmniFM installs `fpcalc` inside the Docker image during build.

- Preferred Debian package: `libchromaprint-tools`
- Fallback package name: `chromaprint-tools`
- The build now verifies both `ffmpeg` and `fpcalc` before the image is finalized.

After `./install.sh` or `./update.sh`, OmniFM also prints runtime checks so you can see whether `fpcalc` is actually available inside the running container.

### Troubleshooting fingerprint fallback

If recognition does not work reliably, check these points in order:

1. `./update.sh --settings` -> `Track-Erkennung` is enabled and the `ACOUSTID_API_KEY` is set.
2. `docker compose logs -f omnifm` shows both `ffmpeg verfuegbar` and `Audio-Erkennung bereit`.
3. The station itself is reachable and sends enough clean audio for a short fingerprint sample.
4. Your usage matches the AcoustID terms for the free API.

If you see `fpcalc exited with code 3: ERROR: Error decoding audio frame (End of file)`, OmniFM most likely captured too little usable audio from the stream. The current fallback now retries more defensively and treats this as a soft failure, but you should still increase the capture window in `./update.sh --settings`:

- `Fingerprint Sample in Sekunden`: start with `22`
- `Minimale brauchbare Audio-Dauer in Sekunden`: start with `10`
- `Timeout in Millisekunden`: keep `28000` to `35000`

If the Docker build fails while installing Chromaprint, inspect the build log directly. The management scripts now stop on build failures instead of reporting a false success.

## Important environment variables

### Core bot setup

| Variable | Purpose |
| --- | --- |
| `BOT_1_TOKEN`, `BOT_2_TOKEN`, ... | Discord bot tokens |
| `BOT_1_CLIENT_ID`, `BOT_2_CLIENT_ID`, ... | Discord application IDs |
| `BOT_1_NAME`, `BOT_2_NAME`, ... | Display names |
| `BOT_1_TIER`, `BOT_2_TIER`, ... | `free`, `pro`, or `ultimate` |
| `COMMANDER_BOT_INDEX` | Which `BOT_N` acts as commander |
| `COMMAND_REGISTRATION_MODE` | `guild` (default), `global`, or `hybrid` |

### Web and API

| Variable | Purpose |
| --- | --- |
| `WEB_PORT` | External website/API port |
| `WEB_INTERNAL_PORT` | Internal container port |
| `PUBLIC_WEB_URL` | Public base URL for checkout and webhooks |
| `WEB_DOMAIN` | Optional domain helper |
| `CORS_ALLOWED_ORIGINS` | Allowed browser origins |
| `CHECKOUT_RETURN_ORIGINS` | Allowed Stripe return URLs |
| `API_ADMIN_TOKEN` | Admin token for sensitive API routes |
| `SYNC_GUILD_COMMANDS_ON_BOOT` | Legacy fallback for guild mode if `COMMAND_REGISTRATION_MODE` is unset |
| `CLEAN_GLOBAL_COMMANDS_ON_BOOT` | Removes stale global commands when commander/workers should not expose them |

### Premium and billing

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe backend key |
| `STRIPE_PUBLIC_KEY` | Optional Stripe public key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook validation |
| `PRO_TRIAL_ENABLED` | Enables or disables the one-time Pro trial |
| `LICENSE_EXPIRY_REMINDER_DAYS` | Reminder schedule before expiry |

### Now-playing and embeds

| Variable | Purpose |
| --- | --- |
| `NOW_PLAYING_ENABLED` | Enables live embed updates |
| `NOW_PLAYING_POLL_MS` | Refresh interval |
| `NOW_PLAYING_COVER_ENABLED` | Enables cover lookup |
| `NOW_PLAYING_FETCH_TIMEOUT_MS` | Timeout for ICY metadata fetch |
| `NOW_PLAYING_MAX_METAINT_BYTES` | Max accepted ICY metadata interval |
| `SONG_HISTORY_ENABLED` | Enables `/history` |
| `SONG_HISTORY_MAX_PER_GUILD` | History retention per guild |

### Audio fingerprint fallback

| Variable | Purpose |
| --- | --- |
| `NOW_PLAYING_RECOGNITION_ENABLED` | Enables fingerprint fallback |
| `ACOUSTID_API_KEY` | AcoustID client key |
| `NOW_PLAYING_RECOGNITION_SAMPLE_SECONDS` | FFmpeg sample duration |
| `NOW_PLAYING_RECOGNITION_MIN_SECONDS` | Minimum usable captured audio before fingerprinting |
| `NOW_PLAYING_RECOGNITION_TIMEOUT_MS` | End-to-end recognition timeout |
| `NOW_PLAYING_RECOGNITION_CACHE_TTL_MS` | Positive recognition cache TTL |
| `NOW_PLAYING_RECOGNITION_FAILURE_TTL_MS` | Negative cache TTL |
| `NOW_PLAYING_RECOGNITION_SCORE_THRESHOLD` | Minimum accepted AcoustID score |
| `NOW_PLAYING_MUSICBRAINZ_ENABLED` | Enables MusicBrainz enrichment |

### Voice and reconnect behavior

| Variable | Purpose |
| --- | --- |
| `VOICE_CHANNEL_STATUS_ENABLED` | Updates channel status where supported |
| `VOICE_CHANNEL_STATUS_TEMPLATE` | Template for the voice channel status |
| `VOICE_STATE_RECONCILE_ENABLED` | Enables periodic voice reconciliation |
| `VOICE_STATE_RECONCILE_MS` | Voice reconciliation interval |
| `STREAM_RESTART_BASE_MS` | Base stream restart delay |
| `STREAM_RESTART_MAX_MS` | Max stream restart delay |
| `STREAM_ERROR_COOLDOWN_THRESHOLD` | Error threshold before cooldown |
| `STREAM_ERROR_COOLDOWN_MS` | Cooldown after repeated stream failures |
| `VOICE_RECONNECT_MAX_MS` | Max voice reconnect backoff |
| `VOICE_RECONNECT_CIRCUIT_BREAKER_ATTEMPTS` | Failed reconnects before retries are paused |
| `VOICE_RECONNECT_CIRCUIT_BREAKER_MS` | Pause duration after the reconnect circuit opens |
| `VOICE_TRANSIENT_RECHECK_MS` | Delay before re-checking transient voice-state mismatches |
| `VOICE_STATE_MISSING_CONFIRMATIONS` | Missing voice-state confirmations required before tearing down an active session |
| `VOICE_RECONNECT_RESOURCE_CONFIRMATIONS` | Missing guild/channel/permission confirmations required before clearing reconnect targets |
| `PREMIUM_GUILD_ACCESS_MODE` | `restrict` keeps bots in guilds, `leave` enforces the old auto-leave behavior |

### Logging

| Variable | Purpose |
| --- | --- |
| `LOG_MAX_MB` | Max size of `logs/bot.log` and `logs/error.log` before rotation |
| `LOG_MAX_FILES` | Max rotated log files retained per log type |
| `LOG_MAX_DAYS` | Max age of rotated log files |

### DiscordBotList

| Variable | Purpose |
| --- | --- |
| `DISCORDBOTLIST_ENABLED` | Enables discordbotlist.com sync features |
| `DISCORDBOTLIST_TOKEN` | discordbotlist.com API token |
| `DISCORDBOTLIST_BOT_ID` | Explicit bot ID for stats sync and public listing checks |
| `DISCORDBOTLIST_SLUG` | Optional public listing slug used for the public DiscordBotList page |
| `DISCORDBOTLIST_WEBHOOK_SECRET` | Vote webhook secret for `POST /api/discordbotlist/vote` |
| `DISCORDBOTLIST_STATS_SCOPE` | `commander` or `aggregate` |
| `DISCORDBOTLIST_COMMANDS_SYNC_MS` | Periodic command sync interval |
| `DISCORDBOTLIST_STATS_SYNC_MS` | Periodic stats sync interval |
| `DISCORDBOTLIST_VOTE_SYNC_MS` | Periodic vote sync interval |

### Discord Bots (bots.gg)

| Variable | Purpose |
| --- | --- |
| `BOTSGG_ENABLED` | Enables the dedicated `discord.bots.gg` stats sync |
| `BOTSGG_TOKEN` | `discord.bots.gg` owner API token |
| `BOTSGG_BOT_ID` | Explicit bot ID for the stats endpoint |
| `BOTSGG_STATS_SCOPE` | `commander` or `aggregate` |
| `BOTSGG_STARTUP_DELAY_MS` | Initial delay before the first stats post after boot |
| `BOTSGG_STATS_SYNC_MS` | Periodic stats sync interval |

### Top.gg

| Variable | Purpose |
| --- | --- |
| `TOPGG_ENABLED` | Enables the dedicated Top.gg sync features |
| `TOPGG_TOKEN` | Top.gg API token |
| `TOPGG_BOT_ID` | Explicit bot ID for Top.gg stats and listing URLs |
| `TOPGG_WEBHOOK_SECRET` | Shared secret for `POST /api/topgg/webhook` |
| `TOPGG_STATS_SCOPE` | `commander` or `aggregate` |
| `TOPGG_STARTUP_DELAY_MS` | Initial delay before the first sync after boot |
| `TOPGG_PROJECT_SYNC_MS` | Periodic project metadata sync interval |
| `TOPGG_COMMANDS_SYNC_MS` | Periodic Top.gg command sync interval |
| `TOPGG_STATS_SYNC_MS` | Periodic Top.gg stats sync interval |
| `TOPGG_VOTE_SYNC_MS` | Periodic Top.gg vote sync interval |
| `TOPGG_VOTE_SYNC_START_DAYS` | Initial API vote backfill window in days |

### Email

| Variable | Purpose |
| --- | --- |
| `SMTP_HOST` | SMTP host |
| `SMTP_PORT` | SMTP port |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `SMTP_FROM` | Sender address |
| `ADMIN_EMAIL` | Internal notification address |

## API overview

### General

- `GET /api/health`
- `GET /api/stats`
- `GET /api/stations`
- `GET /api/workers`
- `GET /api/legal`
- `GET /api/privacy`

### Dashboard

- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/dashboard/capabilities?serverId=...`
- `GET /api/dashboard/stats?serverId=...`
- `GET /api/dashboard/stats/detail?serverId=...`
- `GET/PUT /api/dashboard/settings?serverId=...`
- `POST /api/dashboard/settings/digest-preview?serverId=...`
- `POST /api/dashboard/settings/digest-test?serverId=...`
- `GET/PUT /api/dashboard/perms?serverId=...`
- `GET /api/dashboard/roles?serverId=...`
- `GET/POST/PUT/DELETE /api/dashboard/events?serverId=...`
- `POST /api/dashboard/events/preview?serverId=...`
- `GET/POST/PUT/DELETE /api/dashboard/custom-stations?serverId=...`
- `GET /api/dashboard/license?serverId=...`
- `PUT /api/dashboard/license?serverId=...`
- `POST /api/dashboard/license/offer-preview?serverId=...`
- `POST /api/dashboard/license/checkout?serverId=...`
- `GET /api/dashboard/exports/stats?serverId=...`
- `GET /api/dashboard/exports/custom-stations?serverId=...`
- `POST /api/dashboard/exports/webhook-test?serverId=...`

### Dashboard subscription flow

- `GET /api/dashboard/license` returns the current tier, plan limits, upgrade hints, coupon/trial metadata, and replay-protected billing activity.
- `PUT /api/dashboard/license` updates the stored subscription email for checkout, invoices, and license communication.
- `POST /api/dashboard/license/offer-preview` validates coupon codes against the existing seat bundle and target renewal or upgrade.
- `POST /api/dashboard/license/checkout` starts Stripe for renewals or Pro-to-Ultimate upgrades without changing the current seat bundle.

### Premium

- `GET /api/premium/pricing`
- `GET /api/premium/check?serverId=...`
- `POST /api/premium/checkout`
- `POST /api/premium/trial`
- `POST /api/premium/offer/preview`
- `POST /api/premium/verify`
- `POST /api/premium/webhook`
- `GET/POST/PATCH/DELETE /api/premium/offers`
- `GET /api/premium/redemptions`

### DiscordBotList

- `POST /api/discordbotlist/vote`
- `POST /api/discordbotlist/sync`
- `GET /api/discordbotlist/status`
- `GET /api/discordbotlist/votes`

Notes:
- The owner API is documented on `docs.discordbotlist.com`.
- OmniFM uses the documented owner API on `https://discordbotlist.com/api/v1`.
- Command publishing uses the documented `Authorization: Bot <token>` header.
- Stats include `shard_id` when the commander shard can be resolved.
- `GET /api/discordbotlist/status?live=1` checks the public DiscordBotList page when `DISCORDBOTLIST_SLUG` is configured.
- The published docs currently document stats, commands, and vote webhooks, but not a writable presence endpoint. Treat the public `online` field as informational, not as something your bot can directly force through the documented API.

### Discord Bots (bots.gg)

- `POST /api/botsgg/sync`
- `GET /api/botsgg/status`

Notes:
- The documented owner stats endpoint is `POST https://discord.bots.gg/api/v1/bots/<botId>/stats`.
- OmniFM posts `guildCount` and shard metadata there through the dedicated `BOTSGG_*` configuration.
- `GET /api/botsgg/status?live=1` includes the public listing snapshot from `https://discord.bots.gg/api/v1/bots/<botId>`.
- The public `online` and `status` fields are not directly writable through the documented stats endpoint.

### Top.gg

- `POST /api/topgg/webhook`
- `POST /api/topgg/sync`
- `GET /api/topgg/status`
- `GET /api/topgg/votes`
- `GET /api/topgg/vote-status?userId=...`

Notes:
- OmniFM treats Top.gg as a dedicated third provider and does not mix it with `discordbotlist.com` or `discord.bots.gg`.
- Commands and vote APIs use `https://top.gg/api/v1/projects/@me...`.
- Stats use the documented bot stats endpoint `POST https://top.gg/api/bots/<botId>/stats`.
- Webhooks support both the classic shared-secret authorization style and the newer `x-topgg-signature` HMAC signature format.

### Shared vote events

- `discordbotlist.com` and `top.gg` votes are normalized into a shared internal vote-event store.
- `discord.bots.gg` is currently used only for stats and listing diagnostics because the documented API does not expose vote webhooks or vote polling endpoints.
- This shared vote-event layer is intended for future cross-provider reward handling without coupling rewards to a single listing site.
- Admin API:
  - `GET /api/vote-events/status`
  - optional filters: `provider=discordbotlist|topgg`, `userId=<discordUserId>`, `limit=<n>`

## Discord commands

### General

- `/help`
- `/play`
- `/stop`
- `/pause`
- `/resume`
- `/stations`
- `/list`
- `/workers`
- `/invite`
- `/status`
- `/health`
- `/diag`
- `/language`
- `/premium`
- `/license`

### Pro and Ultimate

- `/now`
- `/history`
- `/stats`
- `/event`
- `/perm`

### Ultimate-specific capability

- Custom station URLs and guild-managed custom stations

## Data files

These JSON files are used in file-store mode and are preserved by `update.sh`:

- `stations.json`
- `premium.json`
- `bot-state.json`
- `dashboard.json`
- `custom-stations.json`
- `command-permissions.json`
- `guild-languages.json`
- `song-history.json`
- `listening-stats.json`
- `scheduled-events.json`
- `coupons.json`
- `discordbotlist.json`
- `botsgg.json`
- `topgg.json`
- `vote-events.json`

## Editing the project

### Useful paths

- `src/bot/runtime.js`: main runtime, voice handling, embeds, slash command behavior
- `src/services/now-playing.js`: ICY metadata, cover lookups, recognition handoff
- `src/services/audio-recognition.js`: Chromaprint, AcoustID, MusicBrainz fallback
- `src/api/server.js`: HTTP API, Premium routes, DBL routes
- `frontend/src/components/Premium.js`: React Premium checkout UI
- `install.sh`: initial interactive installer
- `update.sh`: operations and settings menu

### Common tasks

Change stations:

```bash
node src/stations-cli.js
```

Manage Premium data:

```bash
node src/premium-cli.js wizard
node src/premium-cli.js offers
```

`node src/premium-cli.js offers` supports classic discount/referral offers and `direct_grant` codes that activate a free Pro/Ultimate license without Stripe.

Redeploy after code changes:

```bash
docker compose up -d --build
```

## Testing

Node syntax and unit tests:

```bash
npm test
```

Frontend production build:

```bash
npm --prefix frontend install
npm --prefix frontend run build
```

## Local development

For local testing in VS Code, use two terminals inside the repository root.

1. Create a local `.env` from `.env.example` and fill at least:
   - `BOT_1_TOKEN`
   - `BOT_1_CLIENT_ID`
2. Optional for the full dashboard login flow:
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET`
   - `DISCORD_REDIRECT_URI=http://localhost:8081/api/auth/discord/callback`
3. Install dependencies:

```bash
npm install
npm --prefix frontend install
```

4. Start the bot, API, and production-style local website:

```bash
npm start
```

Open:

- `http://localhost:8081` for the integrated website served by the Node backend
- `http://localhost:8081/api/health` for a quick API check

5. Optional frontend live-reload development server:

```bash
npm run frontend:start
```

Then open:

- `http://localhost:3000`

The React dev server automatically talks to the local backend on `http://localhost:8081` unless `REACT_APP_BACKEND_URL` is set.

Notes:

- If `.env` is empty or missing, OmniFM stops with `No bot configuration found. Set BOT_1_TOKEN/BOT_1_CLIENT_ID.`
- `PUBLIC_WEB_URL=http://localhost:8081` is recommended for local premium and OAuth testing.
- MongoDB is optional for local work. Without `MONGO_URL` or `MONGO_ENABLED=1`, OmniFM falls back to file-based stores.

## Live acceptance after deploy or update

Use the built-in live check after a restart, update, or provider configuration change:

```bash
node scripts/phase6-live-check.mjs --base-url https://omnifm.xyz --admin-token "$API_ADMIN_TOKEN" --docker-service omnifm --log-since 30m
```

The script checks:

- admin status endpoints for `discordbotlist.com`, `discord.bots.gg`, `top.gg`, and unified vote events
- live public provider snapshots where the provider exposes them
- recent Docker logs for hard failure patterns such as guild leaves, access-denied shutdowns, reconnect circuits, and startup errors

Useful inputs:

- `--base-url` or `OMNIFM_BASE_URL`
- `--admin-token` or `OMNIFM_ADMIN_TOKEN`
- `--docker-service` or `OMNIFM_DOCKER_SERVICE`
- `--log-since` or `OMNIFM_LOG_SINCE`

The script exits non-zero when a configured provider fails its status checks or when recent logs contain hard failure patterns.

## Troubleshooting

### Bots appear stuck in voice but are not actually there

- Check `docker compose logs -f omnifm`
- Make sure `VOICE_STATE_RECONCILE_ENABLED=1`
- Check channel permissions for `Connect`, `Speak`, and `ViewChannel`
- Rebuild after updates because reconnect logic lives in runtime code

### Stream metadata is missing

- Some stations simply do not send usable ICY metadata
- OmniFM now handles that cleanly and can optionally try fingerprint fallback
- Enable fingerprint fallback only if you have a valid AcoustID key and are allowed to use it

### Premium trial button is missing

- The React frontend must be rebuilt after deployment changes
- Verify `PRO_TRIAL_ENABLED=1`
- Check `GET /api/premium/pricing` and confirm `trial.enabled` is `true`

### DiscordBotList votes or commands are not syncing

- Verify `DISCORDBOTLIST_TOKEN`
- Verify `DISCORDBOTLIST_BOT_ID`
- If you want public listing checks, verify `DISCORDBOTLIST_SLUG`
- Verify `DISCORDBOTLIST_WEBHOOK_SECRET`
- Set `PUBLIC_WEB_URL`
- Use `POST /api/discordbotlist/sync` with the admin token to force a sync
- Check `GET /api/discordbotlist/status?live=1`
- If `DISCORDBOTLIST_SLUG` is configured, verify the public page at `https://discordbotlist.com/bots/<slug>`
- If command publishing still fails, confirm the owner token is valid and the application can publish the current slash-command payload

### bots.gg guild count is not updating

- Verify `BOTSGG_ENABLED=1`
- Verify `BOTSGG_TOKEN`
- Verify `BOTSGG_BOT_ID`
- Use `POST /api/botsgg/sync` with the admin token to force a stats post
- Check `GET /api/botsgg/status?live=1`
- Confirm the listing is claimed correctly on `discord.bots.gg`
- Confirm the selected library on the listing matches the real implementation, for example `discord.js`
- Do not expect the documented stats endpoint to directly force the public `online` field

### Top.gg votes, commands, or stats are not syncing

- Verify `TOPGG_ENABLED=1`
- Verify `TOPGG_TOKEN`
- Verify `TOPGG_BOT_ID`
- If webhooks should work, verify `TOPGG_WEBHOOK_SECRET`
- Set `PUBLIC_WEB_URL`
- Use `POST /api/topgg/sync` with the admin token to force project, commands, stats, and votes
- Check `GET /api/topgg/status?live=1`
- Check `GET /api/topgg/votes`
- Check `GET /api/vote-events/status`
- For a single user, check `GET /api/topgg/vote-status?userId=<discordUserId>&source=discord`
- If live webhooks still fail, verify that Top.gg is configured to send either the legacy secret or the signed webhook requests to `POST /api/topgg/webhook`

## Notes

- The installer and updater are designed to preserve runtime JSON data across updates.
- The production site requires the React build under `frontend/build`.
- The old `web/` fallback is no longer used automatically. It is only available as an explicit emergency fallback with `WEB_ALLOW_LEGACY_FALLBACK=1`.
