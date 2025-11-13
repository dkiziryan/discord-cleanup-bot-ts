# Discord Clean Up Bot

TypeScript Discord bot + React dashboard for running ad-hoc moderation utilities. The bot still responds to `?testing` in any guild text channel by logging `works <timestamp>` to the terminal, and now exposes an HTTP API that powers a single-page app (SPA) for generating CSV reports of users with zero messages across specific channels.

## Prerequisites

- Node.js 18+ and npm (Discord.js v14 requires Node 18.17 or newer).
- A Discord bot application with the **Message Content Intent** and **Server Members Intent** enabled in the [Discord Developer Portal](https://discord.com/developers/applications).
- The bot invited to your server with permissions to view and read message history for the target channels.

## Discord Bot Set Up

1. Go to [https://discord.com/developers/applications](https://discord.com/developers/applications) and click **New Application**.
2. Name it anything (this becomes your bot's name).
3. Open the **Bot** tab in the left sidebar, click **Add Bot**, then **Reset Token** and copy the token (this is what your bot script uses).  
   **Important:** Treat your token like a password—never share it.
4. Invite the bot to your server: in the same application, go to **OAuth2 → URL Generator**.
5. Under **Scopes**, check `bot`, then under **Bot Permissions** select the permissions you need (e.g., **Read Messages/View Channels** and **Send Messages**).
6. Copy the generated URL at the bottom, open it in your browser, pick your server, and click **Authorize**.
7. Your bot is now in the server

## Chat Commands

- `?testing` – quick connectivity check that logs the timestamp in your backend console.
- `?cleanuproles` – previews every role with zero members, then waits for a `yes`/`no` reply before deleting.

## Backend Setup (Discord bot + API)

1. Install backend dependencies:
   ```bash
   npm install
   ```
2. Copy the environment template and fill in your details:
   ```bash
   cp .env.example .env
   ```
   Required keys:
   - `DISCORD_TOKEN` – bot token from the Developer Portal.
   - `DISCORD_GUILD_ID` – ID of the guild you want to scan (Right-click the server name in Discord app → Copy Server ID).
   - `HTTP_PORT` (optional) – port for the HTTP API (defaults to `3001`).
3. (Optional) Provide default target channels by creating `config/targetChannels.local.json` with a JSON array of channel names (e.g., `["in-between", "general"]`). This file is `.gitignore`d so you can keep a personal list per machine. If the file is missing or invalid, the bot falls back to the committed `config/targetChannels.json` (currently an empty array), and ultimately to an empty list.
4. (Optional) Customize the default categories excluded from inactive scans (and channel archiving) by creating `config/inactiveCategories.local.json`. The bot falls back to `config/inactiveCategories.json`, and finally to the built-in list if both files are missing. Each file should contain a JSON array of category names.

### Running the backend

- TypeScript dev mode (hot reload via `ts-node`):
  ```bash
  npm run dev
  ```
- Compile + run JavaScript output:
  ```bash
  npm run build
  npm start
  ```

On startup you should see `[timestamp] Logged in as <bot>` and `[timestamp] HTTP server listening on port ...`. Typing `?testing` in Discord will continue to log `works ...` in the console.

### CSV output

Generated reports are written to the `csv/` directory with timestamped filenames (`users-YYYYMMDD-HHMMSS.csv`). The directory is ignored by git and created automatically.

## Frontend Setup (React SPA)

The dashboard lives in `web/` and was bootstrapped with Vite (React + TypeScript).

1. Install frontend dependencies:
   ```bash
   npm install --prefix web
   ```
2. Run the dev server (proxied to the backend API on port 3001):
   ```bash
   npm run dev:web
   ```
   or inside the `web` folder:
   ```bash
   cd web
   npm run dev
   ```
3. Visit the URL printed by Vite (defaults to `http://localhost:5173`). The SPA fetches default channel names from the backend and offers a CTA to trigger the scan. Supplied channel names in the UI take priority over the config file; leave the field blank to fall back to the defaults.

### Frontend build commands

- Build static assets:
  ```bash
  npm run build:web
  ```
- Preview the production build:
  ```bash
  npm run preview:web
  ```

## API Overview

- `GET /api/health` – simple readiness probe.
- `GET /api/default-channels` – returns the configured channel name list.
- `GET /api/scan-status` – exposes the current scan progress (channel, counts, status).
- `POST /api/zero-messages` – triggers the scan. Optional body `{ "channelNames": string[] }`. Response includes summary data and the CSV path.
- `POST /api/cleanup-roles` – runs a dry run by default (omit the body or send `{}`) and reports zero-member roles. Send `{ "dryRun": false }` after reviewing the preview to delete them.
- `POST /api/inactive-channels` – body `{ "days": number, "action"?: "archive" | "delete" }` returns channels without messages in the last N days. Provide `channelIds` and `"dryRun": false` to archive or delete the selected channels (defaults to archiving into the `🗄️ Archived` category).

## Project Structure Highlights

- `src/index.ts` – boots the Discord client, registers legacy `?testing` listener, and starts the HTTP API server.
- `src/server.ts` – Express server exposing the REST endpoints that power the SPA.
- `src/services/zeroMessageScanner.ts` – core logic that scans channels, calculates zero-message users, and writes CSVs.
- `config/targetChannels.json` – editable channel names used as defaults.
- `web/` – Vite React app for the dashboard.

Tweak or extend the scanner logic, add more routes, or build new UI components as needed. Happy automating!
