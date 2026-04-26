import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import type { Client } from "discord.js";
import connectPgSimple from "connect-pg-simple";
import crypto from "node:crypto";
import path from "node:path";
import pg from "pg";

import {
  mapResultToResponse,
  scanZeroMessageUsers,
} from "./services/message/zeroMessageScanner";
import { ScanCancelledError } from "./services/errors";
import { listCsvFiles } from "./services/csv/csvManager";
import { readScopedCsvFile } from "./services/csv/csvStorage";

import type {
  CsvFileListResponse,
  IgnoredUsersResponse,
  KickFromCsvResponse,
  InactiveScanStatus,
  ScanStatus,
  ScanZeroMessagesOptions,
  StartServerOptions,
} from "./models/types";
import { archiveInactiveChannels } from "./services/channel/archiveChannels";
import { kickMembersFromCsv } from "./services/csv/kickFromCsv";
import {
  scanInactiveMembers,
  mapInactiveResultToResponse,
} from "./services/inactivity/inactiveScanner";
import {
  completeJob,
  createRunningJob,
  failJob,
  listJobHistory,
  registerCsvArtifact,
} from "./services/jobs/jobService";
import {
  collectInactiveExcludedCategories,
  readGuildSettings,
} from "./services/guildSettings";
import {
  authenticateDiscordUser,
  buildDiscordLoginUrl,
} from "./services/auth/discordOAuth";
import { getPostLoginRedirectUrl } from "./services/auth/postLoginRedirect";
import { renderUnauthorizedPage } from "./services/auth/unauthorizedPage";
import {
  authorizeDiscordUser,
  listAuthorizedGuilds,
} from "./services/auth/authorization";
import { parseChannelNames } from "./services/channel/channelInput";
import { cleanupEmptyRoles } from "./services/role/roleCleanup";
import {
  addIgnoredUser,
  buildIgnoredUsersCsv,
  importIgnoredUsers,
  listIgnoredUsers,
  mapIgnoredUserRecord,
  removeIgnoredUser,
} from "./services/ignore/ignoredUsers";
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
  createScanCancellationController,
  type ScanCancellationController,
} from "./utils/cancellationController";

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
});

const LISTEN_HOSTS = {
  local: "127.0.0.1",
  production: "0.0.0.0",
} as const;

const JSON_BODY_LIMIT = "1mb";
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX = 30;
const WORKFLOW_RATE_LIMIT_MAX = 40;
const RATE_LIMITED_API_WORKFLOW_PATHS = new Set([
  "/cleanup-roles",
  "/inactive-channels",
  "/ignored-users",
  "/ignored-users/import",
  "/zero-messages",
  "/inactive-scan",
  "/kick-from-csv",
]);

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

  app.get("/auth/discord/login", (_req, res) => {
    try {
      const oauthState = crypto.randomUUID();
      _req.session.oauthState = oauthState;
      const loginUrl = buildDiscordLoginUrl(oauthState);
      _req.session.save((error) => {
        if (error) {
          res
            .status(500)
            .json({ message: "Failed to initialize login session." });
          return;
        }

        res.redirect(loginUrl);
      });
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.get("/auth/discord/callback", async (req, res) => {
    const code =
      typeof req.query.code === "string" ? req.query.code.trim() : "";
    const state =
      typeof req.query.state === "string" ? req.query.state.trim() : "";
    if (!code) {
      res.status(400).json({ message: "Missing Discord OAuth code." });
      return;
    }

    if (!state || !req.session.oauthState || state !== req.session.oauthState) {
      res.status(400).json({ message: "Invalid Discord OAuth state." });
      return;
    }

    delete req.session.oauthState;

    try {
      const user = await authenticateDiscordUser(code);
      const authorizedGuilds = await listAuthorizedGuilds(
        client,
        user.discordUserId,
      );
      const selectedGuild =
        authorizedGuilds.find((guild) => guild.id === guildId) ??
        authorizedGuilds[0] ??
        null;
      req.session.authUser = {
        ...user,
        isAuthorized: authorizedGuilds.length > 0,
        authorizedGuilds,
        selectedGuildId: selectedGuild?.id ?? null,
      };

      if (!req.session.authUser.isAuthorized) {
        res
          .status(403)
          .type("html")
          .send(renderUnauthorizedPage("no_admin_guilds"));
        return;
      }

      req.session.save((error) => {
        if (error) {
          res.status(500).json({ message: "Failed to persist login session." });
          return;
        }

        res.redirect(getPostLoginRedirectUrl(isProduction));
      });
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.get("/auth/me", (req, res) => {
    if (!req.session.authUser) {
      res.status(401).json({ message: "Not authenticated." });
      return;
    }

    res.json({ user: req.session.authUser });
  });

  app.post(
    "/auth/guild/select",
    requireAuthenticatedSession,
    async (req, res) => {
      const requestedGuildId =
        typeof req.body?.guildId === "string" ? req.body.guildId.trim() : "";
      const authUser = req.session.authUser;
      const authorizedGuild = authUser?.authorizedGuilds.find(
        (guild) => guild.id === requestedGuildId,
      );

      if (!authUser || !authorizedGuild) {
        res
          .status(403)
          .json({ message: "Server management permission required." });
        return;
      }

      const authorization = await authorizeDiscordUser(
        client,
        authorizedGuild.id,
        authUser.discordUserId,
      );

      if (!authorization.isAuthorized) {
        authUser.authorizedGuilds = authUser.authorizedGuilds.filter(
          (guild) => guild.id !== authorizedGuild.id,
        );
        authUser.selectedGuildId = authUser.authorizedGuilds[0]?.id ?? null;
        authUser.isAuthorized = authUser.authorizedGuilds.length > 0;
        res
          .status(403)
          .json({ message: "Server management permission required." });
        return;
      }

      authUser.selectedGuildId = authorizedGuild.id;
      req.session.save((error) => {
        if (error) {
          res
            .status(500)
            .json({ message: "Failed to persist selected guild." });
          return;
        }

        res.json({ user: authUser });
      });
    },
  );

  app.post("/auth/logout", (req, res) => {
    req.session.destroy((error) => {
      if (error) {
        res.status(500).json({ message: "Failed to clear session." });
        return;
      }

      res.clearCookie("connect.sid");
      res.json({ message: "Logged out." });
    });
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

  app.get("/api/scan-status", (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    res.json({ ...getScanStatus(activeGuildId) });
  });

  app.get("/api/inactive-status", (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    res.json({ ...getInactiveStatus(activeGuildId) });
  });

  app.get("/api/csv-files", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    const discordUserId = requireAuthenticatedDiscordUserId(req, res);
    if (!discordUserId) {
      return;
    }

    try {
      const files = await listCsvFiles({
        guildId: activeGuildId,
        discordUserId,
      });
      const payload: CsvFileListResponse = { files };
      res.json(payload);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
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

  app.get("/api/ignored-users", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    try {
      const users = await listIgnoredUsers(activeGuildId);
      const payload: IgnoredUsersResponse = {
        users: users.map(mapIgnoredUserRecord),
        count: users.length,
      };
      res.json(payload);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/ignored-users", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    try {
      const discordUserId =
        typeof req.body?.discordUserId === "string"
          ? req.body.discordUserId
          : "";
      const user = await addIgnoredUser(activeGuildId, discordUserId);
      res.status(201).json({ user: mapIgnoredUserRecord(user) });
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.post("/api/ignored-users/import", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    try {
      const result = await importIgnoredUsers(activeGuildId, {
        csvText:
          typeof req.body?.csvText === "string" ? req.body.csvText : undefined,
        discordUserIds: Array.isArray(req.body?.discordUserIds)
          ? req.body.discordUserIds
          : undefined,
      });
      res.json({
        ...result,
        message: `Imported ${result.addedCount} ignored user(s).`,
      });
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.delete("/api/ignored-users/:discordUserId", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    try {
      const removed = await removeIgnoredUser(
        activeGuildId,
        req.params.discordUserId,
      );
      if (!removed) {
        res.status(404).json({ message: "Ignored user not found." });
        return;
      }

      res.json({ message: "Ignored user removed." });
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.get("/api/ignored-users/export", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    try {
      const users = await listIgnoredUsers(activeGuildId);
      const contents = buildIgnoredUsersCsv(users);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ignored-users-${activeGuildId}.csv"`,
      );
      res.send(contents);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.get("/api/csv-files/:filename/download", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    const discordUserId = requireAuthenticatedDiscordUserId(req, res);
    if (!discordUserId) {
      return;
    }

    try {
      const csvFile = await readScopedCsvFile(req.params.filename, {
        guildId: activeGuildId,
        discordUserId,
      });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${csvFile.filename.replace(/"/g, "")}"`,
      );
      res.setHeader("Content-Length", String(csvFile.size));
      res.send(csvFile.contents);
    } catch (error) {
      const message = (error as Error).message;
      const status = message.includes("not found") ? 404 : 400;
      res.status(status).json({ message });
    }
  });

  app.post("/api/cancel-scan", (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    const activeCancellation = activeCancellationByGuild.get(activeGuildId);
    if (!isProcessingByGuild.get(activeGuildId) || !activeCancellation) {
      res.status(409).json({ message: "No scan is currently running." });
      return;
    }

    activeCancellation.cancel();
    updateScanStatus(activeGuildId, {
      lastMessage: "Cancelling scan…",
      errorMessage: null,
    });
    res.json({ message: "Cancellation requested." });
  });

  app.post("/api/cancel-inactive", (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    const inactiveCancellation =
      inactiveCancellationByGuild.get(activeGuildId);
    if (
      !isInactiveProcessingByGuild.get(activeGuildId) ||
      !inactiveCancellation
    ) {
      res
        .status(409)
        .json({ message: "No inactive scan is currently running." });
      return;
    }

    inactiveCancellation.cancel();
    updateInactiveStatus(activeGuildId, {
      lastMessage: "Cancelling inactive scan…",
      errorMessage: null,
    });
    res.json({ message: "Cancellation requested." });
  });

  app.post("/api/cancel-kick", (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    const kickCancellation = kickCancellationByGuild.get(activeGuildId);
    if (!isKickProcessingByGuild.get(activeGuildId) || !kickCancellation) {
      res.status(409).json({ message: "No kick job is currently running." });
      return;
    }

    kickCancellation.cancel();
    res.json({ message: "Cancellation requested." });
  });

  app.post("/api/cleanup-roles", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    if (!client.isReady()) {
      res.status(503).json({
        message: "Discord client is not ready yet. Try again shortly.",
      });
      return;
    }

    if (isRoleCleanupProcessingByGuild.get(activeGuildId)) {
      res
        .status(409)
        .json({ message: "A role removal job is already running." });
      return;
    }

    const dryRun = req.body?.dryRun === false ? false : true;
    isRoleCleanupProcessingByGuild.set(activeGuildId, true);

    try {
      const result = await cleanupEmptyRoles(client, {
        guildId: activeGuildId,
        dryRun,
      });
      let message = "No empty roles found.";
      if (result.deletableRoleCount > 0) {
        message = dryRun
          ? `Found ${result.deletableRoleCount} empty role(s) ready for deletion.`
          : `Deleted ${result.deletedRoleCount} empty role(s).`;
      }

      res.json({
        message,
        data: result,
      });
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    } finally {
      isRoleCleanupProcessingByGuild.set(activeGuildId, false);
    }
  });

  app.post("/api/inactive-channels", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    if (!client.isReady()) {
      res.status(503).json({
        message: "Discord client is not ready yet. Try again shortly.",
      });
      return;
    }

    if (isChannelArchiveProcessingByGuild.get(activeGuildId)) {
      res.status(409).json({ message: "An archive job is already running." });
      return;
    }

    const days = Number(req.body?.days ?? 90);
    if (!Number.isFinite(days) || days <= 0) {
      res.status(400).json({ message: "Provide a positive number of days." });
      return;
    }

    const dryRun = req.body?.dryRun === false ? false : true;
    const channelIds = Array.isArray(req.body?.channelIds)
      ? req.body.channelIds.filter(
          (value: unknown) =>
            typeof value === "string" && value.trim().length > 0,
        )
      : [];
    const action = req.body?.action === "delete" ? "delete" : "archive";

    if (!dryRun && channelIds.length === 0) {
      res
        .status(400)
        .json({ message: "Select at least one channel to archive." });
      return;
    }

    isChannelArchiveProcessingByGuild.set(activeGuildId, true);
    try {
      const result = await archiveInactiveChannels(client, {
        guildId: activeGuildId,
        days,
        channelIds: dryRun ? undefined : channelIds,
        dryRun,
        action,
        excludedCategories:
          await collectInactiveExcludedCategories(activeGuildId),
      });

      const message = dryRun
        ? result.inactiveChannels.length > 0
          ? `Found ${result.inactiveChannels.length} inactive channel(s).`
          : "No inactive channels found."
        : action === "archive"
          ? `Archived ${result.processedCount} channel(s).`
          : `Deleted ${result.processedCount} channel(s).`;

      res.json({
        message,
        data: {
          ...result,
          days,
          action,
        },
      });
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    } finally {
      isChannelArchiveProcessingByGuild.set(activeGuildId, false);
    }
  });

  app.post("/api/zero-messages", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    if (!client.isReady()) {
      res.status(503).json({
        message: "Discord client is not ready yet. Try again shortly.",
      });
      return;
    }

    if (isProcessingByGuild.get(activeGuildId)) {
      res.status(409).json({ message: "A scan is already in progress." });
      return;
    }

    const requestChannels = parseChannelNames(req.body?.channelNames);
    const dryRun = Boolean(req.body?.dryRun);
    const countReactionsAsActivity = Boolean(req.body?.countReactionsAsActivity);
    const discordUserId = requireAuthenticatedDiscordUserId(req, res);
    if (!discordUserId) {
      return;
    }

    let targetChannelNames = requestChannels;
    if (targetChannelNames.length === 0) {
      const settings = await readGuildSettings(activeGuildId);
      targetChannelNames = settings.defaultTargetChannels;
    }

    let jobId: string;
    try {
      jobId = await createRunningJob({
        discordUserId,
        inputJson: {
          dryRun,
          countReactionsAsActivity,
          guildId: activeGuildId,
          targetChannelNames,
        },
        type: "zero_scan",
      });
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
      return;
    }

    const totalChannels = targetChannelNames.length;
    updateScanStatus(activeGuildId, {
      inProgress: true,
      currentChannel: null,
      currentIndex: 0,
      totalChannels,
      processedChannels: 0,
      processedMembers: 0,
      totalMembers: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      lastMessage:
        totalChannels > 0
          ? "Preparing scan…"
          : "No target channels configured.",
      errorMessage: null,
      result: null,
    });

    isProcessingByGuild.set(activeGuildId, true);
    const cancellationController = createScanCancellationController();
    activeCancellationByGuild.set(activeGuildId, cancellationController);
    res.status(202).json({
      message: "Scan started.",
      channels: targetChannelNames,
    });

    void (async () => {
      const scanStatus = getScanStatus(activeGuildId);
      const scanOptions: ScanZeroMessagesOptions = {
        guildId: activeGuildId,
        discordUserId,
        targetChannelNames,
        dryRun,
        countReactionsAsActivity,
        isCancelled: cancellationController.isCancelled,
        progressCallbacks: {
          onChannelStart(channelName, index, total) {
            updateScanStatus(activeGuildId, {
              inProgress: true,
              currentChannel: channelName,
              currentIndex: index,
              totalChannels: total,
              processedChannels: Math.max(index - 1, 0),
              processedMembers: scanStatus.processedMembers,
              lastMessage: `Scanning #${channelName}`,
            });
          },
          onChannelComplete(_channelName, index, total) {
            updateScanStatus(activeGuildId, {
              processedChannels: Math.min(index, total),
            });
          },
          onMemberProgress(processedMembers, totalMembers) {
            updateScanStatus(activeGuildId, {
              processedMembers,
              totalMembers,
            });
          },
        },
      };

      try {
        const result = await scanZeroMessageUsers(client, scanOptions);
        const responseData = mapResultToResponse(result);
        const response = {
          message: dryRun
            ? "Dry run complete. Empty CSV generated."
            : `Scan complete. Found ${result.zeroMessageUsers.length} users with zero messages.`,
          channels: targetChannelNames,
          data: responseData,
        };
        await registerCsvArtifact({
          csvPath: result.csvPath,
          jobId,
        });
        await completeJob(jobId, {
          resultJson: {
            channels: targetChannelNames,
            data: responseData,
            message: response.message,
          },
        });

        updateScanStatus(activeGuildId, {
          inProgress: false,
          currentChannel: null,
          currentIndex: 0,
          processedChannels: scanStatus.totalChannels,
          processedMembers: scanStatus.totalMembers,
          finishedAt: new Date().toISOString(),
          lastMessage: `Scan complete. Found ${result.zeroMessageUsers.length} users.`,
          errorMessage: null,
          result: response,
        });
      } catch (error) {
        if (error instanceof ScanCancelledError) {
          const scanStatus = getScanStatus(activeGuildId);
          updateScanStatus(activeGuildId, {
            inProgress: false,
            currentChannel: null,
            currentIndex: 0,
            processedChannels: scanStatus.processedChannels,
            finishedAt: new Date().toISOString(),
            lastMessage: "Scan cancelled by user.",
            errorMessage: null,
            result: null,
          });
          await failJob(jobId, {
            errorMessage: error.message,
            status: "cancelled",
          }).catch((jobError) => {
            console.error(
              `Failed to persist cancelled zero-message job ${jobId}: ${(jobError as Error).message}`,
            );
          });
          return;
        }

        const errorMessage = (error as Error).message;
        updateScanStatus(activeGuildId, {
          inProgress: false,
          currentChannel: null,
          currentIndex: 0,
          processedChannels: 0,
          totalChannels: 0,
          processedMembers: 0,
          totalMembers: 0,
          finishedAt: new Date().toISOString(),
          errorMessage,
          lastMessage: "Scan failed.",
          result: null,
        });
        await failJob(jobId, {
          errorMessage,
          status: "failed",
        }).catch((jobError) => {
          console.error(
            `Failed to persist failed zero-message job ${jobId}: ${(jobError as Error).message}`,
          );
        });
      } finally {
        isProcessingByGuild.set(activeGuildId, false);
        activeCancellationByGuild.delete(activeGuildId);
      }
    })();
  });

  app.post("/api/inactive-scan", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    if (!client.isReady()) {
      res.status(503).json({
        message: "Discord client is not ready yet. Try again shortly.",
      });
      return;
    }

    if (isInactiveProcessingByGuild.get(activeGuildId)) {
      res
        .status(409)
        .json({ message: "An inactive scan is already in progress." });
      return;
    }

    const requestedDays =
      typeof req.body?.days === "number" && Number.isFinite(req.body.days)
        ? Math.max(1, req.body.days)
        : 30;
    const countReactionsAsActivity =
      req.body?.countReactionsAsActivity === undefined
        ? true
        : Boolean(req.body.countReactionsAsActivity);
    const discordUserId = requireAuthenticatedDiscordUserId(req, res);
    if (!discordUserId) {
      return;
    }

    let requestCategories: string[] = [];
    if (Array.isArray(req.body?.excludedCategories)) {
      requestCategories = req.body.excludedCategories
        .map((value: unknown) =>
          typeof value === "string" ? value.trim() : "",
        )
        .filter((value: string) => value.length > 0);
    } else if (typeof req.body?.excludedCategories === "string") {
      requestCategories = req.body.excludedCategories
        .split(",")
        .map((value: string) => value.trim())
        .filter((value: string) => value.length > 0);
    }

    const excludedCategories = await collectInactiveExcludedCategories(
      activeGuildId,
      requestCategories,
    );

    let jobId: string;
    try {
      jobId = await createRunningJob({
        discordUserId,
        inputJson: {
          days: requestedDays,
          excludedCategories,
          countReactionsAsActivity,
          guildId: activeGuildId,
        },
        type: "inactive_scan",
      });
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
      return;
    }

    updateInactiveStatus(activeGuildId, {
      inProgress: true,
      currentChannel: null,
      currentIndex: 0,
      totalChannels: 0,
      processedChannels: 0,
      totalMessages: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      lastMessage: "Preparing inactive scan…",
      errorMessage: null,
    });

    isInactiveProcessingByGuild.set(activeGuildId, true);
    const inactiveController = createScanCancellationController();
    inactiveCancellationByGuild.set(activeGuildId, inactiveController);
    try {
      const result = await scanInactiveMembers(client, {
        guildId: activeGuildId,
        discordUserId,
        days: requestedDays,
        excludedCategories,
        countReactionsAsActivity,
        isCancelled: inactiveController.isCancelled,
        progressCallbacks: {
          onChannelStart(channelName, index, total) {
            updateInactiveStatus(activeGuildId, {
              currentChannel: channelName,
              currentIndex: index,
              totalChannels: total,
              processedChannels: Math.max(index - 1, 0),
              lastMessage: `Scanning #${channelName}`,
            });
          },
          onChannelComplete(_channelName, index, total) {
            updateInactiveStatus(activeGuildId, {
              processedChannels: Math.min(index, total),
            });
          },
        },
      });

      updateInactiveStatus(activeGuildId, {
        inProgress: false,
        currentChannel: null,
        currentIndex: 0,
        processedChannels: result.processedChannels.length,
        totalChannels:
          result.processedChannels.length + result.skippedChannels.length,
        totalMessages: result.totalMessagesScanned,
        finishedAt: new Date().toISOString(),
        lastMessage: `Inactive scan complete. Found ${result.inactiveMembers.length} users.`,
        errorMessage: null,
      });

      const responseData = mapInactiveResultToResponse(result);
      const message = `Inactive scan complete. Found ${result.inactiveMembers.length} inactive users.`;
      await registerCsvArtifact({
        csvPath: result.csvPath,
        jobId,
      });
      await completeJob(jobId, {
        resultJson: {
          data: responseData,
          message,
        },
      });

      res.json({
        message,
        data: responseData,
      });
    } catch (error) {
      if (error instanceof ScanCancelledError) {
        const inactiveStatus = getInactiveStatus(activeGuildId);
        updateInactiveStatus(activeGuildId, {
          inProgress: false,
          currentChannel: null,
          currentIndex: 0,
          processedChannels: inactiveStatus.processedChannels,
          totalChannels: inactiveStatus.totalChannels,
          totalMessages: inactiveStatus.totalMessages,
          finishedAt: new Date().toISOString(),
          lastMessage: "Inactive scan cancelled by user.",
          errorMessage: null,
        });
        await failJob(jobId, {
          errorMessage: error.message,
          status: "cancelled",
        }).catch((jobError) => {
          console.error(
            `Failed to persist cancelled inactive scan job ${jobId}: ${(jobError as Error).message}`,
          );
        });
        res.status(499).json({ message: error.message });
      } else {
        const errorMessage = (error as Error).message;
        updateInactiveStatus(activeGuildId, {
          inProgress: false,
          currentChannel: null,
          currentIndex: 0,
          processedChannels: 0,
          totalChannels: 0,
          totalMessages: 0,
          finishedAt: new Date().toISOString(),
          lastMessage: "Inactive scan failed.",
          errorMessage,
        });
        await failJob(jobId, {
          errorMessage,
          status: "failed",
        }).catch((jobError) => {
          console.error(
            `Failed to persist failed inactive scan job ${jobId}: ${(jobError as Error).message}`,
          );
        });
        res.status(500).json({ message: errorMessage });
      }
    } finally {
      isInactiveProcessingByGuild.set(activeGuildId, false);
      inactiveCancellationByGuild.delete(activeGuildId);
    }
  });

  app.post("/api/kick-from-csv", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    if (!client.isReady()) {
      res.status(503).json({
        message: "Discord client is not ready yet. Try again shortly.",
      });
      return;
    }

    if (isKickProcessingByGuild.get(activeGuildId)) {
      res.status(409).json({ message: "A kick job is already running." });
      return;
    }

    const filenames = Array.isArray(req.body?.filenames)
      ? req.body.filenames.filter(
          (value: unknown) => typeof value === "string" && value.trim() !== "",
        )
      : [];
    const dryRun = Boolean(req.body?.dryRun);
    const discordUserId = requireAuthenticatedDiscordUserId(req, res);
    if (!discordUserId) {
      return;
    }

    if (filenames.length === 0) {
      res.status(400).json({ message: "Provide at least one CSV filename." });
      return;
    }

    isKickProcessingByGuild.set(activeGuildId, true);
    const kickController = createScanCancellationController();
    kickCancellationByGuild.set(activeGuildId, kickController);
    try {
      const results = await kickMembersFromCsv(client, activeGuildId, {
        filenames,
        dryRun,
        discordUserId,
        isCancelled: kickController.isCancelled,
      });

      const response: KickFromCsvResponse = {
        message: dryRun
          ? `Dry run complete. ${results.length} file(s) processed.`
          : `Kick job finished for ${results.length} file(s).`,
        results,
      };
      res.json(response);
    } catch (error) {
      if (error instanceof ScanCancelledError) {
        res.status(499).json({ message: error.message });
      } else {
        res.status(500).json({ message: (error as Error).message });
      }
    } finally {
      isKickProcessingByGuild.set(activeGuildId, false);
      kickCancellationByGuild.delete(activeGuildId);
    }
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
