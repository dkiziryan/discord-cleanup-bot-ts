import cors from "cors";
import express from "express";
import type { Client } from "discord.js";

import { readConfiguredChannelNames } from "./config/targetChannels";
import { mapResultToResponse, scanZeroMessageUsers } from "./services/zeroMessageScanner";
import { ScanCancelledError } from "./services/errors";
import { listCsvFiles } from "./services/csvManager";
import { kickMembersFromCsv } from "./services/kickFromCsv";
import { mapInactiveResultToResponse, scanInactiveMembers } from "./services/inactiveScanner";
import { cleanupEmptyRoles } from "./services/roleCleanup";
import { archiveInactiveChannels } from "./services/archiveChannels";
import { DEFAULT_INACTIVE_CATEGORIES } from "./shared/constants";
import type {
  CsvFileListResponse,
  KickFromCsvResponse,
  InactiveScanStatus,
  ScanStatus,
  ScanZeroMessagesOptions,
  StartServerOptions,
} from "./models/types";

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

type ScanCancellationController = {
  cancel: () => void;
  isCancelled: () => boolean;
};

const createScanCancellationController = (): ScanCancellationController => {
  let cancelled = false;
  return {
    cancel() {
      cancelled = true;
    },
    isCancelled: () => cancelled,
  };
};

export function startHttpServer(client: Client, options: StartServerOptions) {
  const { port, guildId } = options;
  const app = express();

  app.use(cors());
  app.use(express.json());

  let isProcessing = false;
  let isKickProcessing = false;
  let isInactiveProcessing = false;
  let isRoleCleanupProcessing = false;
  let isChannelArchiveProcessing = false;
  let activeCancellation: ScanCancellationController | null = null;
  let inactiveCancellation: ScanCancellationController | null = null;
  let kickCancellation: ScanCancellationController | null = null;
  const scanStatus = initialScanStatus();
  const updateScanStatus = (partial: Partial<ScanStatus>) => {
    Object.assign(scanStatus, partial);
  };
  const inactiveStatus = initialInactiveStatus();
  const updateInactiveStatus = (partial: Partial<InactiveScanStatus>) => {
    Object.assign(inactiveStatus, partial);
  };

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      discordReady: Boolean(client.isReady()),
    });
  });

  app.get("/api/default-channels", async (_req, res) => {
    const channels = await readConfiguredChannelNames();
    res.json({ channels });
  });

  app.get("/api/inactive-defaults", (_req, res) => {
    res.json({ categories: [...DEFAULT_INACTIVE_CATEGORIES] });
  });

  app.get("/api/scan-status", (_req, res) => {
    res.json({ ...scanStatus });
  });

  app.get("/api/inactive-status", (_req, res) => {
    res.json({ ...inactiveStatus });
  });

  app.get("/api/csv-files", async (_req, res) => {
    try {
      const files = await listCsvFiles();
      const payload: CsvFileListResponse = { files };
      res.json(payload);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/cancel-scan", (_req, res) => {
    if (!isProcessing || !activeCancellation) {
      res.status(409).json({ message: "No scan is currently running." });
      return;
    }

    activeCancellation.cancel();
    updateScanStatus({
      lastMessage: "Cancelling scan…",
      errorMessage: null,
    });
    res.json({ message: "Cancellation requested." });
  });

  app.post("/api/cancel-inactive", (_req, res) => {
    if (!isInactiveProcessing || !inactiveCancellation) {
      res.status(409).json({ message: "No inactive scan is currently running." });
      return;
    }

    inactiveCancellation.cancel();
    updateInactiveStatus({
      lastMessage: "Cancelling inactive scan…",
      errorMessage: null,
    });
    res.json({ message: "Cancellation requested." });
  });

  app.post("/api/cancel-kick", (_req, res) => {
    if (!isKickProcessing || !kickCancellation) {
      res.status(409).json({ message: "No kick job is currently running." });
      return;
    }

    kickCancellation.cancel();
    res.json({ message: "Cancellation requested." });
  });

  app.post("/api/cleanup-roles", async (req, res) => {
    if (!client.isReady()) {
      res.status(503).json({ message: "Discord client is not ready yet. Try again shortly." });
      return;
    }

    if (isRoleCleanupProcessing) {
      res.status(409).json({ message: "A role cleanup is already running." });
      return;
    }

    const dryRun = req.body?.dryRun === false ? false : true;
    isRoleCleanupProcessing = true;

    try {
      const result = await cleanupEmptyRoles(client, { guildId, dryRun });
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
      isRoleCleanupProcessing = false;
    }
  });

  app.post("/api/inactive-channels", async (req, res) => {
    if (!client.isReady()) {
      res.status(503).json({ message: "Discord client is not ready yet. Try again shortly." });
      return;
    }

    if (isChannelArchiveProcessing) {
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
      ? req.body.channelIds.filter((value: unknown) => typeof value === "string" && value.trim().length > 0)
      : [];
    const action = req.body?.action === "delete" ? "delete" : "archive";

    if (!dryRun && channelIds.length === 0) {
      res.status(400).json({ message: "Select at least one channel to archive." });
      return;
    }

    isChannelArchiveProcessing = true;
    try {
      const result = await archiveInactiveChannels(client, {
        guildId,
        days,
        channelIds: dryRun ? undefined : channelIds,
        dryRun,
        action,
        excludedCategories: collectInactiveExcludedCategories(),
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
      isChannelArchiveProcessing = false;
    }
  });

  app.post("/api/zero-messages", async (req, res) => {
    if (!client.isReady()) {
      res.status(503).json({ message: "Discord client is not ready yet. Try again shortly." });
      return;
    }

    if (isProcessing) {
      res.status(409).json({ message: "A scan is already in progress." });
      return;
    }

    const requestChannels = parseChannelNames(req.body?.channelNames);
    const dryRun = Boolean(req.body?.dryRun);

    let targetChannelNames = requestChannels;
    if (targetChannelNames.length === 0) {
      targetChannelNames = await readConfiguredChannelNames();
    }

    const totalChannels = targetChannelNames.length;
    updateScanStatus({
      inProgress: true,
      currentChannel: null,
      currentIndex: 0,
      totalChannels,
      processedChannels: 0,
      processedMembers: 0,
      totalMembers: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      lastMessage: totalChannels > 0 ? "Preparing scan…" : "No target channels configured.",
      errorMessage: null,
    });

    isProcessing = true;
    const cancellationController = createScanCancellationController();
    activeCancellation = cancellationController;
    try {
      const scanOptions: ScanZeroMessagesOptions = {
        guildId,
        targetChannelNames,
        dryRun,
        isCancelled: cancellationController.isCancelled,
        progressCallbacks: {
          onChannelStart(channelName, index, total) {
            updateScanStatus({
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
            updateScanStatus({
              processedChannels: Math.min(index, total),
            });
          },
          onMemberProgress(processedMembers, totalMembers) {
            updateScanStatus({
              processedMembers,
              totalMembers,
            });
          },
        },
      };

      const result = await scanZeroMessageUsers(client, scanOptions);

      updateScanStatus({
        inProgress: false,
        currentChannel: null,
        currentIndex: 0,
        processedChannels: scanStatus.totalChannels,
        processedMembers: scanStatus.totalMembers,
        finishedAt: new Date().toISOString(),
        lastMessage: `Scan complete. Found ${result.zeroMessageUsers.length} users.`,
        errorMessage: null,
      });

      res.json({
        message: dryRun
          ? "Dry run complete. Empty CSV generated."
          : `Scan complete. Found ${result.zeroMessageUsers.length} users with zero messages.`,
        channels: targetChannelNames,
        data: mapResultToResponse(result),
      });
    } catch (error) {
      if (error instanceof ScanCancelledError) {
        updateScanStatus({
          inProgress: false,
          currentChannel: null,
          currentIndex: 0,
          processedChannels: scanStatus.processedChannels,
          finishedAt: new Date().toISOString(),
          lastMessage: "Scan cancelled by user.",
          errorMessage: null,
        });
        res.status(499).json({ message: error.message });
        return;
      }

      const errorMessage = (error as Error).message;
      updateScanStatus({
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
      });
      res.status(500).json({
        message: errorMessage,
      });
    } finally {
      isProcessing = false;
      activeCancellation = null;
    }
  });

  app.post("/api/inactive-scan", async (req, res) => {
    if (!client.isReady()) {
      res.status(503).json({ message: "Discord client is not ready yet. Try again shortly." });
      return;
    }

    if (isInactiveProcessing) {
      res.status(409).json({ message: "An inactive scan is already in progress." });
      return;
    }

    const requestedDays =
      typeof req.body?.days === "number" && Number.isFinite(req.body.days) ? Math.max(1, req.body.days) : 30;

    let requestCategories: string[] = [];
    if (Array.isArray(req.body?.excludedCategories)) {
      requestCategories = req.body.excludedCategories
        .map((value: unknown) => (typeof value === "string" ? value.trim() : ""))
        .filter((value: string) => value.length > 0);
    } else if (typeof req.body?.excludedCategories === "string") {
      requestCategories = req.body.excludedCategories
        .split(",")
        .map((value: string) => value.trim())
        .filter((value: string) => value.length > 0);
    }

    const excludedCategories = collectInactiveExcludedCategories(requestCategories);

    updateInactiveStatus({
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

    isInactiveProcessing = true;
    const inactiveController = createScanCancellationController();
    inactiveCancellation = inactiveController;
    try {
      const result = await scanInactiveMembers(client, {
        guildId,
        days: requestedDays,
        excludedCategories,
        isCancelled: inactiveController.isCancelled,
        progressCallbacks: {
          onChannelStart(channelName, index, total) {
            updateInactiveStatus({
              currentChannel: channelName,
              currentIndex: index,
              totalChannels: total,
              processedChannels: Math.max(index - 1, 0),
              lastMessage: `Scanning #${channelName}`,
            });
          },
          onChannelComplete(_channelName, index, total) {
            updateInactiveStatus({
              processedChannels: Math.min(index, total),
            });
          },
        },
      });

      updateInactiveStatus({
        inProgress: false,
        currentChannel: null,
        currentIndex: 0,
        processedChannels: result.processedChannels.length,
        totalChannels: result.processedChannels.length + result.skippedChannels.length,
        totalMessages: result.totalMessagesScanned,
        finishedAt: new Date().toISOString(),
        lastMessage: `Inactive scan complete. Found ${result.inactiveMembers.length} users.`,
        errorMessage: null,
      });

      res.json({
        message: `Inactive scan complete. Found ${result.inactiveMembers.length} inactive users.`,
        data: mapInactiveResultToResponse(result),
      });
    } catch (error) {
      if (error instanceof ScanCancelledError) {
        updateInactiveStatus({
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
        res.status(499).json({ message: error.message });
      } else {
        const errorMessage = (error as Error).message;
        updateInactiveStatus({
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
        res.status(500).json({ message: errorMessage });
      }
    } finally {
      isInactiveProcessing = false;
      inactiveCancellation = null;
    }
  });

  app.post("/api/kick-from-csv", async (req, res) => {
    if (!client.isReady()) {
      res.status(503).json({ message: "Discord client is not ready yet. Try again shortly." });
      return;
    }

    if (isKickProcessing) {
      res.status(409).json({ message: "A kick job is already running." });
      return;
    }

    const filenames = Array.isArray(req.body?.filenames)
      ? req.body.filenames.filter((value: unknown) => typeof value === "string" && value.trim() !== "")
      : [];
    const dryRun = Boolean(req.body?.dryRun);

    if (filenames.length === 0) {
      res.status(400).json({ message: "Provide at least one CSV filename." });
      return;
    }

    isKickProcessing = true;
    const kickController = createScanCancellationController();
    kickCancellation = kickController;
    try {
      const results = await kickMembersFromCsv(client, guildId, {
        filenames,
        dryRun,
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
      isKickProcessing = false;
      kickCancellation = null;
    }
  });

  app.listen(port, () => {
    console.log(`[${new Date().toISOString()}] HTTP server listening on port ${port}`);
  });

  return app;
}

function parseChannelNames(raw: unknown): string[] {
  if (!raw) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0);
  }

  if (typeof raw === "string") {
    return raw
      .split(/[,\\n]/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  return [];
}

function collectInactiveExcludedCategories(extra: string[] = []): string[] {
  const envValue = process.env.INACTIVE_EXCLUDED_CATEGORIES ?? "";
  const envCategories = envValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return [...DEFAULT_INACTIVE_CATEGORIES, ...extra, ...envCategories];
}
