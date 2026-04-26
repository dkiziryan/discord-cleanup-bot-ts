import path from "node:path";

import { Client, DiscordAPIError, GuildMember } from "discord.js";

import { ScanCancelledError } from "../errors";

import { loadIgnoredUserIds } from "../ignore/ignoredUsers";
import { writeUserCsv } from "../csv/userCsv";
import { formatDiscordName } from "../../utils/discordMemberName";
import { resolveScanChannelConcurrency } from "../../utils/scanConcurrency";

import type {
  LastActivityType,
  ScanZeroMessagesOptions,
  ScanZeroMessagesResult,
} from "../../models/types";
import {
  fetchGuild,
  resolveTargetChannels,
  scanChannelHistory,
  buildSkippedPreview,
} from "./zeroMessageScannerHelpers";
export type {
  ScanProgressCallbacks,
  ScanZeroMessagesOptions,
  ScanZeroMessagesResult,
} from "../../models/types";

const SUMMARY_PREVIEW_LIMIT = 10;
const SKIPPED_PREVIEW_LIMIT = 5;

export const scanZeroMessageUsers = async (
  client: Client,
  options: ScanZeroMessagesOptions,
): Promise<ScanZeroMessagesResult> => {
  const {
    guildId,
    discordUserId,
    targetChannelNames,
    dryRun = false,
    countReactionsAsActivity = false,
    ignoredUserIds: providedIgnoredUserIds,
    progressCallbacks,
    isCancelled,
  } = options;

  const throwIfCancelled = () => {
    if (isCancelled?.()) {
      throw new ScanCancelledError();
    }
  };

  throwIfCancelled();
  const guild = await fetchGuild(client, guildId);

  if (dryRun) {
    const csvPath = await writeUserCsv(
      "users",
      [],
      { guildId, discordUserId },
      ["User ID", "Username", "Last Activity Type"],
    );
    return {
      guildName: guild.name,
      totalMembersChecked: 0,
      totalMessagesScanned: 0,
      zeroMessageUsers: [],
      lastActivityByMemberId: new Map(),
      skippedChannels: [],
      processedChannels: [],
      csvPath,
      previewNames: [],
      moreCount: 0,
      skippedPreview: "",
    };
  }

  await guild.members.fetch();
  throwIfCancelled();
  await guild.channels.fetch();
  throwIfCancelled();

  const ignoredUserIds =
    providedIgnoredUserIds ?? (await loadIgnoredUserIds(guildId));
  const members = guild.members.cache.filter((member) => !member.user.bot);
  const remainingIds = new Set(
    Array.from(members.keys()).filter(
      (memberId) => !ignoredUserIds.has(memberId),
    ),
  );
  const lastActivityByMemberId = new Map<string, LastActivityType>();
  const totalMembers = remainingIds.size;
  const updateMemberProgress = () => {
    progressCallbacks?.onMemberProgress?.(
      totalMembers - remainingIds.size,
      totalMembers,
    );
  };
  updateMemberProgress();

  if (remainingIds.size === 0) {
    const csvPath = await writeUserCsv(
      "users",
      [],
      { guildId, discordUserId },
      ["User ID", "Username", "Last Activity Type"],
    );
    return {
      guildName: guild.name,
      totalMembersChecked: 0,
      totalMessagesScanned: 0,
      zeroMessageUsers: [],
      lastActivityByMemberId,
      skippedChannels: [],
      processedChannels: [],
      csvPath,
      previewNames: [],
      moreCount: 0,
      skippedPreview: "",
    };
  }

  const targetChannels = resolveTargetChannels(guild, targetChannelNames);

  if (targetChannels.length === 0) {
    throw new Error("No target channels found with the provided names.");
  }

  const totalChannels = targetChannels.length;
  let totalMessagesScanned = 0;
  const skippedChannels: string[] = [];
  const processedChannels: string[] = [];
  let nextChannelIndex = 0;
  let completedChannels = 0;

  const scanNextChannel = async () => {
    while (remainingIds.size > 0) {
      throwIfCancelled();
      const index = nextChannelIndex;
      nextChannelIndex += 1;
      if (index >= targetChannels.length) {
        return;
      }

      const channel = targetChannels[index];
      const channelName = channel.name;
      processedChannels.push(channelName);

      progressCallbacks?.onChannelStart?.(
        channelName,
        index + 1,
        totalChannels,
      );

      try {
        const channelStats = await scanChannelHistory(channel, remainingIds, {
          countReactionsAsActivity,
          lastActivityByMemberId,
          onMemberProgress: updateMemberProgress,
          onCheckCancelled: throwIfCancelled,
        });
        totalMessagesScanned += channelStats.totalMessages;
      } catch (error) {
        if (error instanceof DiscordAPIError) {
          if (error.code === 50013) {
            skippedChannels.push(`${channelName} (forbidden)`);
          } else {
            skippedChannels.push(
              `${channelName} (HTTP error: ${error.message})`,
            );
          }
        } else {
          skippedChannels.push(
            `${channelName} (error: ${(error as Error).message})`,
          );
        }
      } finally {
        completedChannels += 1;
        progressCallbacks?.onChannelComplete?.(
          channelName,
          completedChannels,
          totalChannels,
        );
      }
    }
  };

  const channelConcurrency = Math.min(
    resolveScanChannelConcurrency(),
    targetChannels.length,
  );
  await Promise.all(
    Array.from({ length: channelConcurrency }, () => scanNextChannel()),
  );

  throwIfCancelled();
  const zeroMessageUsers = Array.from(remainingIds)
    .map((memberId) => members.get(memberId))
    .filter((maybeMember): maybeMember is GuildMember => Boolean(maybeMember));

  zeroMessageUsers.sort((a, b) =>
    formatDiscordName(a).localeCompare(formatDiscordName(b)),
  );

  const csvRows = zeroMessageUsers.map((member) => ({
    id: member.id,
    lastActivityType: lastActivityByMemberId.get(member.id) ?? "none",
    username: formatDiscordName(member),
  }));

  throwIfCancelled();
  const csvPath = await writeUserCsv(
    "users",
    csvRows.map((row) => [row.id, row.username, row.lastActivityType]),
    { guildId, discordUserId },
    ["User ID", "Username", "Last Activity Type"],
  );

  const previewNames = zeroMessageUsers
    .slice(0, SUMMARY_PREVIEW_LIMIT)
    .map(formatDiscordName);
  const moreCount = Math.max(zeroMessageUsers.length - previewNames.length, 0);

  const skippedPreview = buildSkippedPreview(
    skippedChannels,
    SKIPPED_PREVIEW_LIMIT,
  );

  return {
    guildName: guild.name,
    totalMembersChecked: totalMembers,
    totalMessagesScanned,
    zeroMessageUsers,
    lastActivityByMemberId,
    skippedChannels,
    processedChannels,
    csvPath,
    previewNames,
    moreCount,
    skippedPreview,
  };
};

export const mapResultToResponse = (result: ScanZeroMessagesResult) => {
  return {
    guildName: result.guildName,
    csvPath: path.basename(result.csvPath),
    zeroMessageCount: result.zeroMessageUsers.length,
    totalMembersChecked: result.totalMembersChecked,
    totalMessagesScanned: result.totalMessagesScanned,
    skippedChannels: result.skippedChannels,
    processedChannels: result.processedChannels,
    previewNames: result.previewNames,
    moreCount: result.moreCount,
    skippedPreview: result.skippedPreview,
  };
};
