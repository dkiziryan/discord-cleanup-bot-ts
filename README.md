# Discord Admin Console

Discord Admin Console is a hosted Discord bot, REST API, and React dashboard for moderation and server management workflows.

Use it to review inactive members, find users with zero messages, remove empty roles, archive stale channels, and act on generated CSV exports.

![Discord Admin Console dashboard](docs/images/dashboard-overview.png)

## Hosted App

Dashboard URL:

https://discord-admin-console-production.up.railway.app/

Bot invite URL:

https://discord.com/oauth2/authorize?client_id=1436087765489160394&permissions=268504082&scope=bot

For local web development, this URL can be overridden with `VITE_BOT_INVITE_URL`.

## How To Use

1. Invite the bot to a Discord server using the bot invite URL.
2. Open the hosted dashboard URL.
3. Log in with Discord.
4. Select a server from the dropdown if your account can manage multiple bot-installed servers.
5. Choose a workflow and review previews/dry runs before destructive actions.

Available dashboard workflows:

- Scan for zero-message users across selected channels
- Scan for inactive members by time window
- Kick members from generated CSV exports
- Preview and delete empty roles
- Preview and archive or delete inactive channels

## Access Rules

Login uses Discord OAuth, but not every Discord user can use the tool.

A user can access a server in the dashboard only when:

- the bot is installed in that server
- the logged-in Discord account has at least one required permission in that server

Allowed Discord permissions:

- `Administrator`
- `Manage Server` / `ManageGuild`
- `Manage Roles`
- `Manage Channels`
- `Kick Members`

Role names do not matter. A role named `manager` only grants access if it actually has one of the permissions above.

## Bot Permissions

The invite URL requests the permissions needed for the current workflows:

- View Channels
- Read Message History
- Send Messages
- Manage Roles
- Manage Channels
- Kick Members

Destructive workflows are guarded by preview or dry-run steps where possible.

## Stack

- Backend: Node.js, TypeScript, Discord.js, Express
- Frontend: React, TypeScript, Vite
- Database: Postgres via Railway
- Hosting: Railway
- Outputs: CSV reports written to `csv/`

## Local Development

Install dependencies:

```bash
npm install
npm install --prefix web
```

Create a local environment file:

```bash
cp .env.example .env
```

Required local environment variables:

- `DATABASE_URL`: Postgres connection string
- `DISCORD_TOKEN`: bot token from the Discord Developer Portal
- `DISCORD_GUILD_ID`: default/fallback guild ID for local bot commands
- `DISCORD_CLIENT_ID`: Discord OAuth client ID
- `DISCORD_CLIENT_SECRET`: Discord OAuth client secret
- `DISCORD_OAUTH_REDIRECT_URI`: local OAuth callback, usually `http://localhost:3001/auth/discord/callback`
- `SESSION_SECRET`: random session signing secret
- `HTTP_PORT`: API port, usually `3001`
- `WEB_APP_URL`: local Vite URL, usually `http://localhost:5173`
- `INACTIVE_EXCLUDED_CATEGORIES`: optional comma-separated fallback category exclusions
- `CSV_DIRECTORY`: optional CSV export directory; defaults to local `csv/`
- `CSV_STORAGE_DRIVER`: optional CSV storage backend; use `s3` for an S3-compatible private bucket, otherwise local disk is used
- `S3_BUCKET`: required when `CSV_STORAGE_DRIVER=s3`
- `S3_REGION`: required by AWS S3 and most compatible providers; defaults to `us-east-1`
- `S3_ENDPOINT`: optional S3-compatible endpoint for providers such as Railway volumes/object storage, Cloudflare R2, or MinIO
- `S3_ACCESS_KEY_ID`: required when `CSV_STORAGE_DRIVER=s3`
- `S3_SECRET_ACCESS_KEY`: required when `CSV_STORAGE_DRIVER=s3`
- `S3_FORCE_PATH_STYLE`: optional; defaults to `true` when `S3_ENDPOINT` is set
- `CSV_FILE_LIMIT_BYTES`: optional per-export cap; defaults to `20971520` (20 MB)
- `CSV_STORAGE_LIMIT_BYTES`: optional total CSV storage cap; defaults to `1073741824` (1 GB)
- `SCAN_CHANNEL_CONCURRENCY`: optional zero-message scan concurrency; defaults to `3` and caps at `5`
- `VITE_BOT_INVITE_URL`: optional public bot invite URL used by the web app

Run the backend:

```bash
npm run dev
```

Run the web app:

```bash
npm run dev:web
```

Open:

http://localhost:5173

## Railway Deployment

The current production deployment runs on Railway.

The production runtime is pinned to Node 24 via `.nvmrc`, `.node-version`, and `package.json` engines.

Production start command:

```bash
npm run start:prod
```

This runs `prisma migrate deploy` before starting the compiled app.

Required Railway service variables:

- `DATABASE_URL`
- `DISCORD_TOKEN`
- `DISCORD_GUILD_ID`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_OAUTH_REDIRECT_URI`
- `SESSION_SECRET`
- `HTTP_PORT`

Optional Railway CSV variables:

- `CSV_DIRECTORY`: use this if a Railway volume is mounted, for example `/data/csv`
- `CSV_STORAGE_DRIVER=s3`: use this with a private S3-compatible bucket instead of local disk
- `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: bucket connection settings when S3 CSV storage is enabled
- `CSV_FILE_LIMIT_BYTES`: per-export cap; defaults to 20 MB
- `CSV_STORAGE_LIMIT_BYTES`: total CSV storage cap; defaults to 1 GB
- `SCAN_CHANNEL_CONCURRENCY`: zero-message scan concurrency; defaults to 3 and caps at 5
- `VITE_BOT_INVITE_URL`: public bot invite URL used by the web app

For the current Railway app, `DISCORD_OAUTH_REDIRECT_URI` should be:

```text
https://discord-admin-console-production.up.railway.app/auth/discord/callback
```

Do not set `WEB_APP_URL` in Railway. It is for local development.

## API Overview

- `GET /auth/discord/login`: start Discord OAuth login
- `GET /auth/discord/callback`: Discord OAuth callback
- `GET /auth/me`: current authenticated user and authorized servers
- `POST /auth/guild/select`: select the active server for dashboard workflows
- `POST /auth/logout`: clear the current session
- `GET /api/health`: readiness probe
- `GET /api/default-channels`: selected server default channels
- `GET /api/inactive-defaults`: selected server inactive category defaults
- `GET /api/scan-status`: zero-message scan progress
- `GET /api/inactive-status`: inactive-member scan progress
- `GET /api/csv-files`: available CSV exports
- `POST /api/zero-messages`: run zero-message scan
- `POST /api/inactive-scan`: run inactive-member scan
- `POST /api/inactive-channels`: preview or process inactive channels
- `POST /api/cleanup-roles`: preview or delete zero-member roles
- `POST /api/kick-from-csv`: kick members from selected CSV files
- `POST /api/cancel-scan`: cancel zero-message scan
- `POST /api/cancel-inactive`: cancel inactive-member scan
- `POST /api/cancel-kick`: cancel kick job

## Security Notes

- Secrets such as `DISCORD_TOKEN`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, and `DATABASE_URL` must stay in local `.env` files or Railway service variables. Do not commit them.
- Discord OAuth is used only for login. Dashboard access is still checked against the selected server and Discord permissions.
- A user can manage a server only if the bot is installed there and their Discord account has `Administrator`, `Manage Server`, `Manage Roles`, `Manage Channels`, or `Kick Members`.
- API requests revalidate server access against Discord permissions before running dashboard workflows.
- CSV exports are scoped by selected server and logged-in Discord user.

## Admin Chat Shortcuts

- `?testing`: quick connectivity check
- `?cleanuproles`: preview zero-member roles, then wait for `yes` or `no`

The hosted dashboard is the primary interface. These shortcuts are retained for admin diagnostics and maintenance.

## Output and Safety

- CSV exports are written to `csv/` locally by default, or to `csv/<guildId>/<discordUserId>/` in a private S3-compatible bucket when `CSV_STORAGE_DRIVER=s3`
- CSV exports are scoped by selected server and logged-in Discord user
- CSV downloads are served through the authenticated API so users can only download CSVs for their selected server and Discord user
- The `csv/` directory is created automatically and ignored by git
- Generated CSV files are capped at 20 MB by default, and total CSV storage is capped at 1 GB by default
- Destructive workflows use previews or dry runs before live actions where possible
- Dashboard access is revalidated against Discord permissions during API requests

## Project Structure

- `src/index.ts`: boots the Discord client and HTTP server
- `src/server.ts`: Express routes for auth and dashboard APIs
- `src/services/auth/`: Discord OAuth and server authorization
- `src/services/message/`: zero-message scan and CSV generation
- `src/services/inactivity/`: inactive-member scan and CSV generation
- `src/services/role/`: empty-role preview and deletion
- `src/services/channel/`: inactive-channel archive and delete workflow
- `src/services/csv/`: CSV file discovery, parsing, writing, and kick-from-CSV workflow
- `web/`: React dashboard
