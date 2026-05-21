import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import type { Client } from "discord.js";
import connectPgSimple from "connect-pg-simple";
import path from "node:path";
import pg from "pg";

import type {
  InactiveScanStatus,
  ScanStatus,
  StartServerOptions,
} from "./models/types";
import {
  listJobHistory,
} from "./services/jobs/jobService";
import { readGuildSettings } from "./services/guildSettings";
import {
  authorizeDiscordUser,
} from "./services/auth/authorization";
import {
  getSelectedGuildId,
  requireAuthenticatedSession,
  requireAuthorizedSession,
} from "./utils/authSession";
import {
  getOriginFromUrl,
  isAllowedBrowserOrigin,
  isDatabaseReady,
} from "./utils/runtimeChecks";
import {
  type ScanCancellationController,
} from "./utils/cancellationController";
import { registerAuthRoutes } from "./routes/authRoutes";
import { registerCsvRoutes } from "./routes/csvRoutes";
import { registerSettingsRoutes } from "./routes/settingsRoutes";
import { registerStatusRoutes } from "./routes/statusRoutes";
import { registerWorkflowRoutes } from "./routes/workflowRoutes";

const initialScanStatus = (): ScanStatus => ({
  inProgress: false,
  currentChannel: null,
  currentIndex: 0,
  totalChannels: 0,
  processedChannels: 0,
  processedMembers: 0,
  totalMembers: 0,
  startedAt: null,
  finishedAt: null,
  lastMessage: null,
  errorMessage: null,
  result: null,
});

const initialInactiveStatus = (): InactiveScanStatus => ({
  inProgress: false,
  currentChannel: null,
  currentIndex: 0,
  totalChannels: 0,
  processedChannels: 0,
  totalMessages: 0,
  startedAt: null,
  finishedAt: null,
  lastMessage: null,
  errorMessage: null,
  result: null,
});

const LISTEN_HOSTS = {
  local: "127.0.0.1",
  production: "0.0.0.0",
} as const;

const JSON_BODY_LIMIT = "1mb";
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX = 30;
const WORKFLOW_RATE_LIMIT_MAX = 40;
const SCAN_RESTART_WAIT_MS = 30_000;
const SCAN_RESTART_POLL_MS = 250;
const MIN_FAST_SCAN_MESSAGES_PER_CHANNEL = 100;
const MAX_FAST_SCAN_MESSAGES_PER_CHANNEL = 100_000;
const RATE_LIMITED_API_WORKFLOW_PATHS = new Set([
  "/cleanup-roles",
  "/inactive-channels",
  "/ignored-users",
  "/ignored-users/import",
  "/zero-messages",
  "/inactive-scan",
  "/kick-from-csv",
]);

export const waitForProcessingToStop = async (
  isProcessing: Map<string, boolean>,
  activeGuildId: string,
  options: {
    timeoutMs?: number;
    pollMs?: number;
  } = {},
): Promise<boolean> => {
  const timeoutMs = options.timeoutMs ?? SCAN_RESTART_WAIT_MS;
  const pollMs = options.pollMs ?? SCAN_RESTART_POLL_MS;
  const deadline = Date.now() + timeoutMs;

  while (isProcessing.get(activeGuildId)) {
    if (Date.now() >= deadline) {
      return false;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return true;
};

const parseMaxMessagesPerChannel = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_FAST_SCAN_MESSAGES_PER_CHANNEL) {
    return undefined;
  }

  return Math.min(parsed, MAX_FAST_SCAN_MESSAGES_PER_CHANNEL);
};

export const formatElapsedDuration = (startedAtMs: number, finishedAtMs: number): string => {
  const elapsedSeconds = Math.max(0, Math.round((finishedAtMs - startedAtMs) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
};

export const startHttpServer = (
  client: Client,
  options: StartServerOptions,
) => {
  const { port, guildId } = options;
  const app = express();

  const isProduction = process.env.NODE_ENV === "production";

  const listenHost = isProduction
    ? LISTEN_HOSTS.production
    : LISTEN_HOSTS.local;

  const sessionSecret = process.env.SESSION_SECRET;
  const databaseUrl = process.env.DATABASE_URL;
  const allowedBrowserOrigins = [
    isProduction ? null : getOriginFromUrl(process.env.WEB_APP_URL),
    getOriginFromUrl(process.env.DISCORD_OAUTH_REDIRECT_URI),
  ].filter((origin): origin is string => Boolean(origin));

  if (!sessionSecret) {
    if (isProduction) {
      throw new Error(
        "Missing SESSION_SECRET environment variable. Add it to your environment.",
      );
    }
  }

  if (!databaseUrl) {
    throw new Error(
      "Missing DATABASE_URL environment variable. Add it to your environment.",
    );
  }

  const sessionPool = new pg.Pool({
    connectionString: databaseUrl,
  });
  const PgSessionStore = connectPgSimple(session);

  app.disable("x-powered-by");
  if (isProduction) {
    app.set("trust proxy", 1);
  }
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          imgSrc: ["'self'", "data:", "https://cdn.discordapp.com"],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          upgradeInsecureRequests: isProduction ? [] : null,
        },
      },
    }),
  );
  app.use(
    ["/auth/discord/login", "/auth/discord/callback"],
    rateLimit({
      windowMs: RATE_LIMIT_WINDOW_MS,
      limit: AUTH_RATE_LIMIT_MAX,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { message: "Too many login attempts. Try again shortly." },
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (isAllowedBrowserOrigin(origin, allowedBrowserOrigins)) {
          callback(null, true);
          return;
        }

        callback(new Error("CORS blocked: local origins only."));
      },
    }),
  );
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(
    session({
      secret: sessionSecret ?? "local-dev-session-secret",
      resave: false,
      saveUninitialized: false,
      proxy: isProduction,
      store: new PgSessionStore({
        pool: sessionPool,
        createTableIfMissing: true,
      }),
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
      },
    }),
  );
  app.use(
    "/api",
    rateLimit({
      windowMs: RATE_LIMIT_WINDOW_MS,
      limit: WORKFLOW_RATE_LIMIT_MAX,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      skip: (req) =>
        req.method !== "POST" || !RATE_LIMITED_API_WORKFLOW_PATHS.has(req.path),
      message: {
        message: "Too many workflow requests. Try again shortly.",
      },
    }),
  );

  const isProcessingByGuild = new Map<string, boolean>();
  const isKickProcessingByGuild = new Map<string, boolean>();
  const isInactiveProcessingByGuild = new Map<string, boolean>();
  const isRoleCleanupProcessingByGuild = new Map<string, boolean>();
  const isChannelArchiveProcessingByGuild = new Map<string, boolean>();
  const activeCancellationByGuild = new Map<string, ScanCancellationController>();
  const inactiveCancellationByGuild = new Map<
    string,
    ScanCancellationController
  >();
  const kickCancellationByGuild = new Map<string, ScanCancellationController>();
  const scanStatusByGuild = new Map<string, ScanStatus>();
  const inactiveStatusByGuild = new Map<string, InactiveScanStatus>();

  const getScanStatus = (activeGuildId: string): ScanStatus => {
    const existingStatus = scanStatusByGuild.get(activeGuildId);
    if (existingStatus) {
      return existingStatus;
    }

    const nextStatus = initialScanStatus();
    scanStatusByGuild.set(activeGuildId, nextStatus);
    return nextStatus;
  };

  const updateScanStatus = (
    activeGuildId: string,
    partial: Partial<ScanStatus>,
  ) => {
    Object.assign(getScanStatus(activeGuildId), partial);
  };

  const getInactiveStatus = (activeGuildId: string): InactiveScanStatus => {
    const existingStatus = inactiveStatusByGuild.get(activeGuildId);
    if (existingStatus) {
      return existingStatus;
    }

    const nextStatus = initialInactiveStatus();
    inactiveStatusByGuild.set(activeGuildId, nextStatus);
    return nextStatus;
  };

  const updateInactiveStatus = (
    activeGuildId: string,
    partial: Partial<InactiveScanStatus>,
  ) => {
    Object.assign(getInactiveStatus(activeGuildId), partial);
  };

  const requireSelectedGuildId = (
    req: express.Request,
    res: express.Response,
  ): string | null => {
    const activeGuildId = getSelectedGuildId(req);
    if (!activeGuildId) {
      res.status(400).json({ message: "Select a server before continuing." });
      return null;
    }

    return activeGuildId;
  };

  const requireAuthenticatedDiscordUserId = (
    req: express.Request,
    res: express.Response,
  ): string | null => {
    const discordUserId = req.session.authUser?.discordUserId ?? null;
    if (!discordUserId) {
      res.status(401).json({ message: "Authentication required." });
      return null;
    }

    return discordUserId;
  };

  app.get("/api/health", async (_req, res) => {
    const dbReady = await isDatabaseReady();
    const discordReady = Boolean(client.isReady());
    const status = dbReady && discordReady ? "ok" : "degraded";
    const httpStatus = status === "ok" ? 200 : 503;

    res.status(httpStatus).json({
      status,
      discordReady,
      dbReady,
    });
  });

  registerAuthRoutes(app, {
    client,
    defaultGuildId: guildId,
    isProduction,
    requireAuthenticatedSession,
  });

  app.use("/api", async (req, res, next) => {
    if (req.path === "/health") {
      next();
      return;
    }

    requireAuthorizedSession(req, res, async () => {
      const authUser = req.session.authUser;
      const selectedGuildId = getSelectedGuildId(req);

      if (!authUser || !selectedGuildId) {
        res
          .status(403)
          .json({ message: "Server management permission required." });
        return;
      }

      try {
        const authorization = await authorizeDiscordUser(
          client,
          selectedGuildId,
          authUser.discordUserId,
        );

        if (!authorization.isAuthorized) {
          authUser.authorizedGuilds = authUser.authorizedGuilds.filter(
            (guild) => guild.id !== selectedGuildId,
          );
          authUser.selectedGuildId = authUser.authorizedGuilds[0]?.id ?? null;
          authUser.isAuthorized = authUser.authorizedGuilds.length > 0;
          res
            .status(403)
            .json({ message: "Server management permission required." });
          return;
        }

        next();
      } catch (error) {
        res.status(500).json({ message: (error as Error).message });
      }
    });
  });

  app.get("/api/default-channels", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    const settings = await readGuildSettings(activeGuildId);
    const channels = settings.defaultTargetChannels;
    res.json({ channels });
  });

  app.get("/api/inactive-defaults", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    const settings = await readGuildSettings(activeGuildId);
    res.json({ categories: settings.inactiveExcludedCategories });
  });

  registerStatusRoutes(app, {
    activeCancellationByGuild,
    getInactiveStatus,
    getScanStatus,
    inactiveCancellationByGuild,
    isInactiveProcessingByGuild,
    isKickProcessingByGuild,
    isProcessingByGuild,
    kickCancellationByGuild,
    requireSelectedGuildId,
    updateInactiveStatus,
    updateScanStatus,
  });

  registerCsvRoutes(app, {
    requireAuthenticatedDiscordUserId,
    requireSelectedGuildId,
  });

  app.get("/api/job-history", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    const discordUserId = requireAuthenticatedDiscordUserId(req, res);
    if (!discordUserId) {
      return;
    }

    const jobs = await listJobHistory(discordUserId, activeGuildId);
    res.json({ jobs });
  });

  registerSettingsRoutes(app, {
    requireSelectedGuildId,
  });

  registerWorkflowRoutes(app, {
    activeCancellationByGuild,
    client,
    formatElapsedDuration,
    getInactiveStatus,
    getScanStatus,
    inactiveCancellationByGuild,
    isChannelArchiveProcessingByGuild,
    isInactiveProcessingByGuild,
    isKickProcessingByGuild,
    isProcessingByGuild,
    isRoleCleanupProcessingByGuild,
    kickCancellationByGuild,
    parseMaxMessagesPerChannel,
    requireAuthenticatedDiscordUserId,
    requireSelectedGuildId,
    updateInactiveStatus,
    updateScanStatus,
    waitForProcessingToStop,
  });

  if (isProduction) {
    const webDistPath = path.resolve(__dirname, "../web/dist");

    app.use(express.static(webDistPath));
    app.use((_req, res) => {
      res.sendFile(path.join(webDistPath, "index.html"));
    });
  }

  app.listen(port, listenHost, () => {
    console.log(
      `[${new Date().toISOString()}] HTTP server listening on http://${listenHost}:${port}`,
    );
  });

  return app;
};
