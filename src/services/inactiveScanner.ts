import {
  AnyThreadChannel,
  ChannelType,
  Client,
  Collection,
  DiscordAPIError,
  Guild,
  GuildMember,
  GuildTextBasedChannel,
} from "discord.js";
import { promises as fs } from "fs";
import path from "path";

import type {
  ScanInactiveMembersOptions,
  ScanInactiveMembersResult,
} from "../models/types";
import { formatDiscordName } from "./zeroMessageScanner";
import { ScanCancelledError } from "./errors";
import { loadIgnoredUserIds } from "./kickFromCsv";

// Cap how many inactive member names we preview in the API response to keep payloads small.
const SUMMARY_PREVIEW_LIMIT = 50;
// Limit how many skipped-channel reasons we show up front before summarizing the rest.
const SKIPPED_PREVIEW_LIMIT = 10;
// Discord refuses uploads larger than ~8 MB, so keep CSV attachments under this threshold.
const DISCORD_FILE_LIMIT = 8 * 1024 * 1024;
const CSV_DIRECTORY = path.resolve(process.cwd(), "csv");

export async function scanInactiveMembers(
  client: Client,
  options: ScanInactiveMembersOptions
): Promise<ScanInactiveMembersResult> {
  const {
    guildId,
    days,
    excludedCategories = [],
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

  const ignoredUserIds = await loadIgnoredUserIds();
  const members = guild.members.cache.filter((member) => !member.user.bot && !ignoredUserIds.has(member.id));
  const remainingIds = new Set(members.keys());

  // Exclude members who joined after the cutoff; they haven't had enough time to be considered inactive.
  for (const member of members.values()) {
    if (member.joinedTimestamp && member.joinedTimestamp > cutoff.getTime()) {
      remainingIds.delete(member.id);
    }
  }

  if (members.size === 0 || remainingIds.size === 0) {
    const csvPath = await writeCsvFile(`inactive_${days}d`, []);
    return {
      guildName: guild.name,
      cutoffIso: cutoff.toISOString(),
      totalMembersChecked: remainingIds.size,
      totalMessagesScanned: 0,
      inactiveMembers: [],
      skippedChannels: [],
      processedChannels: [],
      csvPath,
      previewNames: [],
      moreCount: 0,
      skippedPreview: "",
    };
  }

  const normalizedExcluded = buildExcludedCategorySet(excludedCategories);
  const activeThreads = await guild.channels.fetchActiveThreads().catch(() => null);
  throwIfCancelled();
  const threadCollection = activeThreads ? new Collection(activeThreads.threads) : null;
  const targetChannels = await resolveTargetChannels(
    guild,
    normalizedExcluded,
    threadCollection
  );

  if (targetChannels.length === 0) {
    throw new Error("No eligible channels were found for inactivity scan.");
  }

  const totalChannels = targetChannels.length;
  let totalMessagesScanned = 0;
  const skippedChannels: string[] = [];
  const processedChannels: string[] = [];

  const me = await resolveGuildMe(guild);

  for (let index = 0; index < targetChannels.length; index += 1) {
    throwIfCancelled();
    const channel = targetChannels[index];
    const channelName = channel.name;

    const canReadHistory = me
      ? channel.permissionsFor(me)?.has("ReadMessageHistory") &&
        channel.permissionsFor(me)?.has("ViewChannel")
      : true;

    if (!canReadHistory) {
      skippedChannels.push(`${channelName} (missing history permission)`);
      continue;
    }

    processedChannels.push(channelName);
    progressCallbacks?.onChannelStart?.(channelName, index + 1, totalChannels);

    try {
      const stats = await scanChannelHistorySince(
        channel,
        cutoff,
        remainingIds,
        {
          onCheckCancelled: throwIfCancelled,
        }
      );
      totalMessagesScanned += stats.totalMessages;
    } catch (error) {
      if (error instanceof DiscordAPIError) {
        if (error.code === 50013) {
          skippedChannels.push(`${channelName} (forbidden)`);
        } else {
          skippedChannels.push(`${channelName} (HTTP error: ${error.message})`);
        }
      } else {
        skippedChannels.push(
          `${channelName} (error: ${(error as Error).message})`
        );
      }
    } finally {
      progressCallbacks?.onChannelComplete?.(
        channelName,
        index + 1,
        totalChannels
      );
    }

    if (remainingIds.size === 0) {
      break;
    }
  }

  throwIfCancelled();
  const inactiveMembers = extractMembers(members, remainingIds);

  const csvRows = inactiveMembers.map((member) => ({
    id: member.id,
    username: formatDiscordName(member),
  }));

  const csvPath = await writeCsvFile(
    `inactive_${days}d`,
    csvRows.map((row) => [row.id, row.username])
  );

  const previewNames = inactiveMembers
    .slice(0, SUMMARY_PREVIEW_LIMIT)
    .map(formatDiscordName);
  const moreCount = Math.max(inactiveMembers.length - previewNames.length, 0);

  const skippedPreview = buildSkippedPreview(skippedChannels);

  return {
    guildName: guild.name,
    cutoffIso: cutoff.toISOString(),
    totalMembersChecked: remainingIds.size,
    totalMessagesScanned,
    inactiveMembers,
    skippedChannels,
    processedChannels,
    csvPath,
    previewNames,
    moreCount,
    skippedPreview,
  };
}

function buildExcludedCategorySet(categories: string[]): Set<string> {
  return new Set(
    categories
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0)
  );
}

async function fetchGuild(client: Client, guildId: string): Promise<Guild> {
  const guild = await client.guilds.fetch(guildId);
  if (!guild) {
    throw new Error(`Guild ${guildId} not found.`);
  }
  return guild;
}

async function resolveTargetChannels(
  guild: Guild,
  excludedCategories: Set<string>,
  activeThreads: Collection<string, AnyThreadChannel> | null
): Promise<GuildTextBasedChannel[]> {
  const targets: GuildTextBasedChannel[] = [];
  const seen = new Set<string>();

  const considerChannel = (channel: unknown) => {
    const kind = (channel as { type?: ChannelType }).type;
    if (kind === ChannelType.GuildForum) {
      return;
    }

    if (!channel || typeof (channel as GuildTextBasedChannel).isTextBased !== "function") {
      return;
    }

    const textChannel = channel as GuildTextBasedChannel;
    if (!textChannel.isTextBased()) {
      return;
    }

    const categoryName = resolveCategoryName(textChannel);
    if (categoryName && excludedCategories.has(categoryName)) {
      return;
    }

    if (seen.has(textChannel.id)) {
      return;
    }

    seen.add(textChannel.id);
    targets.push(textChannel);
  };

  const addChildThreads = async (channel: unknown) => {
    const kind = (channel as { type?: ChannelType }).type;
    const threadManager = (channel as { threads?: unknown }).threads as {
      fetchActive?: () => Promise<{ threads: Collection<string, AnyThreadChannel> }>;
      fetchArchived?: (options?: Record<string, unknown>) => Promise<{ threads: Collection<string, AnyThreadChannel> }>;
    } | null;

    // Only text/announcement/forum parents can own threads.
    if (
      !threadManager ||
      (kind !== ChannelType.GuildText &&
        kind !== ChannelType.GuildAnnouncement &&
        kind !== ChannelType.GuildForum)
    ) {
      return;
    }

    try {
      const active = await threadManager.fetchActive?.();
      active?.threads?.forEach((thread) => considerChannel(thread));
    } catch {
      // ignore
    }

    try {
      const publicArchived = await threadManager.fetchArchived?.({ type: "public", limit: 100 });
      publicArchived?.threads?.forEach((thread) => considerChannel(thread));
    } catch {
      // ignore
    }

    try {
      const privateArchived = await threadManager.fetchArchived?.({ type: "private", limit: 100 });
      privateArchived?.threads?.forEach((thread) => considerChannel(thread));
    } catch {
      // ignore
    }
  };

  for (const channel of guild.channels.cache.values()) {
    considerChannel(channel);
    await addChildThreads(channel);
  }

  activeThreads?.forEach((thread) => considerChannel(thread));

  return targets;
}

function resolveCategoryName(channel: GuildTextBasedChannel | AnyThreadChannel): string | null {
  const parent = channel.parent;
  if (!parent) {
    return null;
  }

  if (parent.type === ChannelType.GuildCategory) {
    return parent.name.toLowerCase();
  }

  const grandparent = parent.parent;
  if (grandparent?.type === ChannelType.GuildCategory) {
    return grandparent.name.toLowerCase();
  }

  return null;
}

async function resolveGuildMe(guild: Guild): Promise<GuildMember | null> {
  if (guild.members.me) {
    return guild.members.me;
  }

  if (guild.client.user) {
    try {
      const member = await guild.members.fetch(guild.client.user.id);
      return member;
    } catch {
      return null;
    }
  }

  return null;
}

async function scanChannelHistorySince(
  channel: GuildTextBasedChannel,
  cutoff: Date,
  remainingIds: Set<string>,
  options?: { onCheckCancelled?: () => void }
): Promise<{ totalMessages: number }> {
  const onCheckCancelled = options?.onCheckCancelled;
  let totalMessages = 0;
  let lastMessageId: string | undefined;
  let reachedCutoff = false;

  while (true) {
    onCheckCancelled?.();
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(lastMessageId ? { before: lastMessageId } : {}),
    });

    if (batch.size === 0) {
      break;
    }

    const orderedMessages = Array.from(batch.values()).sort(
      (messageA, messageB) =>
        messageB.createdTimestamp - messageA.createdTimestamp
    );

    for (const message of orderedMessages) {
      onCheckCancelled?.();
      if (message.createdTimestamp < cutoff.getTime()) {
        reachedCutoff = true;
        break;
      }

      totalMessages += 1;
      if (message.author.bot) {
        continue;
      }

      if (remainingIds.has(message.author.id)) {
        remainingIds.delete(message.author.id);
      }

      if (remainingIds.size === 0) {
        break;
      }
    }

    if (remainingIds.size === 0 || reachedCutoff) {
      break;
    }

    const oldestMessage = orderedMessages[orderedMessages.length - 1];
    lastMessageId = oldestMessage.id;
  }

  return { totalMessages };
}

function extractMembers(
  members: Map<string, GuildMember>,
  remainingIds: Set<string>
): GuildMember[] {
  const inactiveMembers = Array.from(remainingIds)
    .map((memberId) => members.get(memberId))
    .filter((maybeMember): maybeMember is GuildMember => Boolean(maybeMember));

  inactiveMembers.sort((a, b) =>
    formatDiscordName(a).localeCompare(formatDiscordName(b))
  );
  return inactiveMembers;
}

async function writeCsvFile(prefix: string, rows: string[][]): Promise<string> {
  await fs.mkdir(CSV_DIRECTORY, { recursive: true });

  const filename = datedCsvFilename(prefix);
  const filepath = path.join(CSV_DIRECTORY, filename);

  const lines = [["User ID", "Username"], ...rows].map((columns) =>
    columns.map(escapeCsvCell).join(",")
  );

  await fs.writeFile(filepath, lines.join("\n"), "utf8");

  try {
    const stats = await fs.stat(filepath);
    if (stats.size > DISCORD_FILE_LIMIT) {
      // Nothing to do yet, but keep parity with zero scanner.
    }
  } catch {
    // ignore
  }

  return filepath;
}

function datedCsvFilename(prefix: string): string {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate()
  )}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(
    now.getSeconds()
  )}`;
  return `${prefix}-${date}-${time}.csv`;
}

function escapeCsvCell(cell: string): string {
  if (cell.includes('"') || cell.includes(",") || cell.includes("\n")) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

function buildSkippedPreview(skippedChannels: string[]): string {
  if (skippedChannels.length === 0) {
    return "";
  }

  const shown = skippedChannels.slice(0, SKIPPED_PREVIEW_LIMIT);
  let preview = shown.join(", ");
  if (skippedChannels.length > SKIPPED_PREVIEW_LIMIT) {
    preview += `, +${skippedChannels.length - SKIPPED_PREVIEW_LIMIT} more`;
  }
  return preview;
}

export function mapInactiveResultToResponse(result: ScanInactiveMembersResult) {
  return {
    guildName: result.guildName,
    csvPath: result.csvPath,
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
}
