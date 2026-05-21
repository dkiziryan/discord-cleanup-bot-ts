import type { Application, Request, Response } from "express";
import type { Client } from "discord.js";

import type {
  InactiveScanStatus,
  KickFromCsvResponse,
  ScanStatus,
  ScanZeroMessagesOptions,
} from "../models/types";
import { archiveInactiveChannels } from "../services/channel/archiveChannels";
import { parseChannelNames } from "../services/channel/channelInput";
import { kickMembersFromCsv } from "../services/csv/kickFromCsv";
import { ScanCancelledError } from "../services/errors";
import {
  collectInactiveExcludedCategories,
  readGuildSettings,
} from "../services/guildSettings";
import {
  mapInactiveResultToResponse,
  scanInactiveMembers,
} from "../services/inactivity/inactiveScanner";
import {
  completeJob,
  createRunningJob,
  failJob,
  registerCsvArtifact,
} from "../services/jobs/jobService";
import {
  mapResultToResponse,
  scanZeroMessageUsers,
} from "../services/message/zeroMessageScanner";
import { cleanupEmptyRoles } from "../services/role/roleCleanup";
import {
  createScanCancellationController,
  type ScanCancellationController,
} from "../utils/cancellationController";

type WorkflowRouteDependencies = {
  activeCancellationByGuild: Map<string, ScanCancellationController>;
  client: Client;
  formatElapsedDuration: (startedAtMs: number, finishedAtMs: number) => string;
  getInactiveStatus: (activeGuildId: string) => InactiveScanStatus;
  getScanStatus: (activeGuildId: string) => ScanStatus;
  inactiveCancellationByGuild: Map<string, ScanCancellationController>;
  isChannelArchiveProcessingByGuild: Map<string, boolean>;
  isInactiveProcessingByGuild: Map<string, boolean>;
  isKickProcessingByGuild: Map<string, boolean>;
  isProcessingByGuild: Map<string, boolean>;
  isRoleCleanupProcessingByGuild: Map<string, boolean>;
  kickCancellationByGuild: Map<string, ScanCancellationController>;
  parseMaxMessagesPerChannel: (value: unknown) => number | undefined;
  requireAuthenticatedDiscordUserId: (
    req: Request,
    res: Response,
  ) => string | null;
  requireSelectedGuildId: (req: Request, res: Response) => string | null;
  updateInactiveStatus: (
    activeGuildId: string,
    partial: Partial<InactiveScanStatus>,
  ) => void;
  updateScanStatus: (
    activeGuildId: string,
    partial: Partial<ScanStatus>,
  ) => void;
  waitForProcessingToStop: (
    isProcessing: Map<string, boolean>,
    activeGuildId: string,
  ) => Promise<boolean>;
};

export const registerWorkflowRoutes = (
  app: Application,
  {
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
  }: WorkflowRouteDependencies,
): void => {
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

      res.json({ message, data: result });
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
        data: { ...result, days, action },
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

    const requestChannels = parseChannelNames(req.body?.channelNames);
    const dryRun = Boolean(req.body?.dryRun);
    const countReactionsAsActivity = Boolean(req.body?.countReactionsAsActivity);
    const maxMessagesPerChannel = parseMaxMessagesPerChannel(
      req.body?.maxMessagesPerChannel,
    );
    const discordUserId = requireAuthenticatedDiscordUserId(req, res);
    if (!discordUserId) {
      return;
    }

    if (isProcessingByGuild.get(activeGuildId)) {
      const scanStatus = getScanStatus(activeGuildId);
      if (scanStatus.inProgress) {
        activeCancellationByGuild.get(activeGuildId)?.cancel();
        updateScanStatus(activeGuildId, {
          lastMessage: "Cancelling current scan before starting a new one…",
          errorMessage: null,
        });
        const stopped = await waitForProcessingToStop(
          isProcessingByGuild,
          activeGuildId,
        );
        if (!stopped) {
          res.status(409).json({
            message: "The previous scan is still cancelling. Try again shortly.",
          });
          return;
        }
      } else {
        isProcessingByGuild.set(activeGuildId, false);
        activeCancellationByGuild.delete(activeGuildId);
      }
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
          ...(maxMessagesPerChannel ? { maxMessagesPerChannel } : {}),
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
        totalChannels > 0 ? "Preparing scan…" : "No target channels configured.",
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
        maxMessagesPerChannel,
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
        await registerCsvArtifact({ csvPath: result.csvPath, jobId });
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

    const requestedDays =
      typeof req.body?.days === "number" && Number.isFinite(req.body.days)
        ? Math.max(1, req.body.days)
        : 30;
    const countReactionsAsActivity =
      req.body?.countReactionsAsActivity === undefined
        ? true
        : Boolean(req.body.countReactionsAsActivity);
    const maxMessagesPerChannel = parseMaxMessagesPerChannel(
      req.body?.maxMessagesPerChannel,
    );
    const discordUserId = requireAuthenticatedDiscordUserId(req, res);
    if (!discordUserId) {
      return;
    }

    if (isInactiveProcessingByGuild.get(activeGuildId)) {
      const inactiveStatus = getInactiveStatus(activeGuildId);
      if (inactiveStatus.inProgress) {
        inactiveCancellationByGuild.get(activeGuildId)?.cancel();
        updateInactiveStatus(activeGuildId, {
          lastMessage: "Cancelling current inactive scan before starting a new one…",
          errorMessage: null,
        });
        const stopped = await waitForProcessingToStop(
          isInactiveProcessingByGuild,
          activeGuildId,
        );
        if (!stopped) {
          res.status(409).json({
            message:
              "The previous inactive scan is still cancelling. Try again shortly.",
          });
          return;
        }
      } else {
        isInactiveProcessingByGuild.set(activeGuildId, false);
        inactiveCancellationByGuild.delete(activeGuildId);
      }
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
          ...(maxMessagesPerChannel ? { maxMessagesPerChannel } : {}),
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
      result: null,
    });

    isInactiveProcessingByGuild.set(activeGuildId, true);
    const inactiveController = createScanCancellationController();
    inactiveCancellationByGuild.set(activeGuildId, inactiveController);
    res.status(202).json({ message: "Inactive scan started." });

    void (async () => {
      const scanStartedAtMs = Date.now();
      const markInactiveScanIdle = () => {
        isInactiveProcessingByGuild.set(activeGuildId, false);
        inactiveCancellationByGuild.delete(activeGuildId);
      };

      try {
        const result = await scanInactiveMembers(client, {
          guildId: activeGuildId,
          discordUserId,
          days: requestedDays,
          excludedCategories,
          countReactionsAsActivity,
          maxMessagesPerChannel,
          isCancelled: inactiveController.isCancelled,
          progressCallbacks: {
            onChannelStart(channelName, index, total) {
              updateInactiveStatus(activeGuildId, {
                currentChannel: channelName,
                currentIndex: index,
                totalChannels: total,
                processedChannels: Math.max(index - 1, 0),
                lastMessage: `Scanning ${channelName}`,
              });
            },
            onChannelComplete(_channelName, index, total) {
              updateInactiveStatus(activeGuildId, {
                processedChannels: Math.min(index, total),
              });
            },
            onMessageProgress(totalMessages) {
              updateInactiveStatus(activeGuildId, { totalMessages });
            },
          },
        });
        const responseData = mapInactiveResultToResponse(result);
        const elapsedDuration = formatElapsedDuration(scanStartedAtMs, Date.now());
        const message = `Inactive scan complete in ${elapsedDuration}. Found ${result.inactiveMembers.length} inactive users.`;
        const response = { message, data: responseData };

        markInactiveScanIdle();
        updateInactiveStatus(activeGuildId, {
          inProgress: false,
          currentChannel: null,
          currentIndex: 0,
          processedChannels: result.processedChannels.length,
          totalChannels:
            result.processedChannels.length + result.skippedChannels.length,
          totalMessages: result.totalMessagesScanned,
          finishedAt: new Date().toISOString(),
          lastMessage: message,
          errorMessage: null,
          result: response,
        });
        await registerCsvArtifact({ csvPath: result.csvPath, jobId }).catch(
          (artifactError) => {
            console.error(
              `Failed to persist inactive scan CSV artifact for job ${jobId}: ${(artifactError as Error).message}`,
            );
          },
        );
        await completeJob(jobId, {
          resultJson: { data: responseData, message },
        }).catch((jobError) => {
          console.error(
            `Failed to persist completed inactive scan job ${jobId}: ${(jobError as Error).message}`,
          );
        });
      } catch (error) {
        if (error instanceof ScanCancelledError) {
          const inactiveStatus = getInactiveStatus(activeGuildId);
          await failJob(jobId, {
            errorMessage: error.message,
            status: "cancelled",
          }).catch((jobError) => {
            console.error(
              `Failed to persist cancelled inactive scan job ${jobId}: ${(jobError as Error).message}`,
            );
          });
          markInactiveScanIdle();
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
            result: null,
          });
        } else {
          const errorMessage = (error as Error).message;
          await failJob(jobId, {
            errorMessage,
            status: "failed",
          }).catch((jobError) => {
            console.error(
              `Failed to persist failed inactive scan job ${jobId}: ${(jobError as Error).message}`,
            );
          });
          markInactiveScanIdle();
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
            result: null,
          });
        }
      } finally {
        markInactiveScanIdle();
      }
    })();
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
};
