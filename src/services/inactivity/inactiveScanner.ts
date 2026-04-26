import path from "node:path";

import { Client, Collection, DiscordAPIError } from "discord.js";

import {
  buildExcludedCategorySet,
  buildSkippedPreview,
  extractMembers,
  fetchGuild,
  resolveGuildMe,
  resolveTargetChannels,
  scanChannelHistorySince,
} from "./inactiveScannerHelpers";
import {
  LastActivityType,
  ScanInactiveMembersOptions,
  ScanInactiveMembersResult,
} from "../../models/types";
import { formatDiscordName } from "../../utils/discordMemberName";
import { resolveScanChannelConcurrency } from "../../utils/scanConcurrency";
import { loadIgnoredUserIds } from "../ignore/ignoredUsers";
import { writeUserCsv } from "../csv/userCsv";
import { ScanCancelledError } from "../errors";

// Cap how many inactive member names we preview in the API response to keep payloads small.
const SUMMARY_PREVIEW_LIMIT = 10;
// Limit how many skipped-channel reasons we show up front before summarizing the rest.
const SKIPPED_PREVIEW_LIMIT = 10;

export const scanInactiveMembers = async (
  client: Client,
  options: ScanInactiveMembersOptions,
): Promise<ScanInactiveMembersResult> => {
  const {
    guildId,
    discordUserId,
    days,
    excludedCategories = [],
    countReactionsAsActivity = true,
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
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  await guild.members.fetch();
  throwIfCancelled();
  await guild.channels.fetch();
  throwIfCancelled();

  const ignoredUserIds =
    providedIgnoredUserIds ?? (await loadIgnoredUserIds(guildId));
  const members = guild.members.cache.filter(
    (member) => !member.user.bot && !ignoredUserIds.has(member.id),
  );
  const remainingIds = new Set(members.keys());
  const lastActivityByMemberId = new Map<string, LastActivityType>();

  // Exclude members who joined after the cutoff; they haven't had enough time to be considered inactive.
  for (const member of members.values()) {
    if (member.joinedTimestamp && member.joinedTimestamp > cutoff.getTime()) {
      remainingIds.delete(member.id);
    }
  }

  const totalMembersChecked = remainingIds.size;

  if (members.size === 0 || remainingIds.size === 0) {
    const csvPath = await writeUserCsv(
      `inactive_${days}d`,
      [],
      {
        guildId,
        discordUserId,
      },
      ["User ID", "Username", "Last Activity Type"],
    );
    return {
      guildName: guild.name,
      cutoffIso: cutoff.toISOString(),
      totalMembersChecked,
      totalMessagesScanned: 0,
      inactiveMembers: [],
      lastActivityByMemberId,
      skippedChannels: [],
      processedChannels: [],
      csvPath,
      previewNames: [],
      moreCount: 0,
      skippedPreview: "",
    };
  }

  const normalizedExcluded = buildExcludedCategorySet(excludedCategories);
  const activeThreads = await guild.channels
    .fetchActiveThreads()
    .catch(() => null);
  throwIfCancelled();
  const threadCollection = activeThreads
    ? new Collection(activeThreads.threads)
    : null;
  const targetChannels = await resolveTargetChannels(
    guild,
    normalizedExcluded,
    threadCollection,
  );

  if (targetChannels.length === 0) {
    throw new Error("No eligible channels were found for inactivity scan.");
  }

  const totalChannels = targetChannels.length;
  let totalMessagesScanned = 0;
  const skippedChannels: string[] = [];
  const processedChannels: string[] = [];

  const me = await resolveGuildMe(guild);

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

      const canReadHistory = me
        ? channel.permissionsFor(me)?.has("ReadMessageHistory") &&
          channel.permissionsFor(me)?.has("ViewChannel")
        : true;

      if (!canReadHistory) {
        skippedChannels.push(`${channelName} (missing history permission)`);
        completedChannels += 1;
        continue;
      }

      processedChannels.push(channelName);
      progressCallbacks?.onChannelStart?.(
        channelName,
        index + 1,
        totalChannels,
      );

      try {
        const stats = await scanChannelHistorySince(
          channel,
          cutoff,
          remainingIds,
          {
            countReactionsAsActivity,
            lastActivityByMemberId,
            onCheckCancelled: throwIfCancelled,
          },
        );
        totalMessagesScanned += stats.totalMessages;
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
  const inactiveMembers = extractMembers(members, remainingIds);

  const csvRows = inactiveMembers.map((member) => ({
    id: member.id,
    lastActivityType: lastActivityByMemberId.get(member.id) ?? "none",
    username: formatDiscordName(member),
  }));

  const csvPath = await writeUserCsv(
    `inactive_${days}d`,
    csvRows.map((row) => [row.id, row.username, row.lastActivityType]),
    { guildId, discordUserId },
    ["User ID", "Username", "Last Activity Type"],
  );

  const previewNames = inactiveMembers
    .slice(0, SUMMARY_PREVIEW_LIMIT)
    .map(formatDiscordName);
  const moreCount = Math.max(inactiveMembers.length - previewNames.length, 0);

  const skippedPreview = buildSkippedPreview(
    skippedChannels,
    SKIPPED_PREVIEW_LIMIT,
  );

  return {
    guildName: guild.name,
    cutoffIso: cutoff.toISOString(),
    totalMembersChecked,
    totalMessagesScanned,
    inactiveMembers,
    lastActivityByMemberId,
    skippedChannels,
    processedChannels,
    csvPath,
    previewNames,
    moreCount,
    skippedPreview,
  };
};

export const mapInactiveResultToResponse = (
  result: ScanInactiveMembersResult,
) => {
  return {
    guildName: result.guildName,
    csvPath: path.basename(result.csvPath),
    cutoffIso: result.cutoffIso,
    inactiveCount: result.inactiveMembers.length,
    totalMembersChecked: result.totalMembersChecked,
    totalMessagesScanned: result.totalMessagesScanned,
    skippedChannels: result.skippedChannels,
    processedChannels: result.processedChannels,
    previewNames: result.previewNames,
    moreCount: result.moreCount,
    skippedPreview: result.skippedPreview,
  };
};
