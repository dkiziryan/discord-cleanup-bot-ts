import {
  ChannelType,
  Client,
  DiscordAPIError,
  Guild,
  GuildMember,
  TextChannel,
} from "discord.js";
import { promises as fs } from "fs";
import path from "path";

import { ScanCancelledError } from "./errors";

import type { ScanZeroMessagesOptions, ScanZeroMessagesResult } from "../models/types";
export type {
  ScanProgressCallbacks,
  ScanZeroMessagesOptions,
  ScanZeroMessagesResult,
} from "../models/types";

const SUMMARY_PREVIEW_LIMIT = 20;
const SKIPPED_PREVIEW_LIMIT = 5;
const DISCORD_FILE_LIMIT = 8 * 1024 * 1024;
const CSV_DIRECTORY = path.resolve(process.cwd(), "csv");

export async function scanZeroMessageUsers(
  client: Client,
  options: ScanZeroMessagesOptions,
): Promise<ScanZeroMessagesResult> {
  const { guildId, targetChannelNames, dryRun = false, progressCallbacks, isCancelled } = options;

  const throwIfCancelled = () => {
    if (isCancelled?.()) {
      throw new ScanCancelledError();
    }
  };

  throwIfCancelled();
  const guild = await fetchGuild(client, guildId);

  if (dryRun) {
    const csvPath = await writeCsvFile("users", []);
    return {
      guildName: guild.name,
      totalMembersChecked: 0,
      totalMessagesScanned: 0,
      zeroMessageUsers: [],
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

  const members = guild.members.cache.filter((member) => !member.user.bot);
  const remainingIds = new Set(members.keys());
  const totalMembers = members.size;
  const updateMemberProgress = () => {
    progressCallbacks?.onMemberProgress?.(totalMembers - remainingIds.size, totalMembers);
  };
  updateMemberProgress();

  if (members.size === 0) {
    const csvPath = await writeCsvFile("users", []);
    return {
      guildName: guild.name,
      totalMembersChecked: 0,
      totalMessagesScanned: 0,
      zeroMessageUsers: [],
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

  for (let index = 0; index < targetChannels.length; index += 1) {
    throwIfCancelled();
    const channel = targetChannels[index];
    const channelName = channel.name;
    processedChannels.push(channelName);

    progressCallbacks?.onChannelStart?.(channelName, index + 1, totalChannels);

    try {
      const channelStats = await scanChannelHistory(channel, remainingIds, {
        onMemberProgress: updateMemberProgress,
        onCheckCancelled: throwIfCancelled,
      });
      totalMessagesScanned += channelStats.totalMessages;
    } catch (error) {
      if (error instanceof DiscordAPIError) {
        if (error.code === 50013) {
          skippedChannels.push(`${channelName} (forbidden)`);
        } else {
          skippedChannels.push(`${channelName} (HTTP error: ${error.message})`);
        }
      } else {
        skippedChannels.push(`${channelName} (error: ${(error as Error).message})`);
      }
    } finally {
      progressCallbacks?.onChannelComplete?.(channelName, index + 1, totalChannels);
    }

    if (remainingIds.size === 0) {
      break;
    }
  }

  throwIfCancelled();
  const zeroMessageUsers = Array.from(remainingIds)
    .map((memberId) => members.get(memberId))
    .filter((maybeMember): maybeMember is GuildMember => Boolean(maybeMember));

  zeroMessageUsers.sort((a, b) => formatDiscordName(a).localeCompare(formatDiscordName(b)));

  const csvRows = zeroMessageUsers.map((member) => ({
    id: member.id,
    username: formatDiscordName(member),
  }));

  throwIfCancelled();
  const csvPath = await writeCsvFile(
    "users",
    csvRows.map((row) => [row.id, row.username]),
  );

  const previewNames = zeroMessageUsers.slice(0, SUMMARY_PREVIEW_LIMIT).map(formatDiscordName);
  const moreCount = Math.max(zeroMessageUsers.length - previewNames.length, 0);

  let skippedPreview = "";
  if (skippedChannels.length > 0) {
    const shown = skippedChannels.slice(0, SKIPPED_PREVIEW_LIMIT);
    skippedPreview = shown.join(", ");
    if (skippedChannels.length > SKIPPED_PREVIEW_LIMIT) {
      skippedPreview += `, +${skippedChannels.length - SKIPPED_PREVIEW_LIMIT} more`;
    }
  }

  return {
    guildName: guild.name,
    totalMembersChecked: members.size,
    totalMessagesScanned,
    zeroMessageUsers,
    skippedChannels,
    processedChannels,
    csvPath,
    previewNames,
    moreCount,
    skippedPreview,
  };
}

async function fetchGuild(client: Client, guildId: string): Promise<Guild> {
  try {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) {
      throw new Error(`Guild ${guildId} not found.`);
    }
    return guild;
  } catch (error) {
    throw new Error(`Failed to fetch guild ${guildId}: ${(error as Error).message}`);
  }
}

function resolveTargetChannels(guild: Guild, channelNames: string[]): TextChannel[] {
  const normalizedTargets = channelNames.map((name) => name.trim().toLowerCase()).filter(Boolean);
  const matched: TextChannel[] = [];

  for (const channel of guild.channels.cache.values()) {
    if (channel?.type === ChannelType.GuildText) {
      const channelName = channel.name.toLowerCase();
      if (normalizedTargets.includes(channelName)) {
        matched.push(channel);
      }
    }
  }

  return matched;
}

async function scanChannelHistory(
  channel: TextChannel,
  remainingIds: Set<string>,
  options: {
    onMemberProgress?: () => void;
    onCheckCancelled?: () => void;
  },
): Promise<{ totalMessages: number }> {
  const { onMemberProgress, onCheckCancelled } = options;
  let totalMessages = 0;
  let lastMessageId: string | undefined;

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
      (messageA, messageB) => messageA.createdTimestamp - messageB.createdTimestamp,
    );

    for (const message of orderedMessages) {
      onCheckCancelled?.();
      totalMessages += 1;

      if (message.author.bot) {
        continue;
      }

      if (remainingIds.has(message.author.id)) {
        remainingIds.delete(message.author.id);
        onMemberProgress?.();
      }

      if (remainingIds.size === 0) {
        break;
      }
    }

    if (remainingIds.size === 0) {
      break;
    }

    const oldestMessage = orderedMessages[0];
    lastMessageId = oldestMessage.id;
  }

  return { totalMessages };
}

export function formatDiscordName(member: GuildMember): string {
  const displayName = member.displayName;
  const tag = member.user.tag;

  if (displayName && displayName !== tag) {
    return `${displayName} (${tag})`;
  }

  return tag;
}

async function writeCsvFile(prefix: string, rows: string[][]): Promise<string> {
  await fs.mkdir(CSV_DIRECTORY, { recursive: true });

  const filename = datedCsvFilename(prefix);
  const filepath = path.join(CSV_DIRECTORY, filename);

  const lines = [["User ID", "Username"], ...rows].map((columns) =>
    columns.map(escapeCsvCell).join(","),
  );

  await fs.writeFile(filepath, lines.join("\n"), "utf8");

  const stats = await fs.stat(filepath);
  if (stats.size > DISCORD_FILE_LIMIT) {
    // Nothing to do here yet, but we keep the check to mimic the Python behavior.
  }

  return filepath;
}

function datedCsvFilename(prefix: string): string {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}-${date}-${time}.csv`;
}

function escapeCsvCell(cell: string): string {
  if (cell.includes('"') || cell.includes(",") || cell.includes("\n")) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

export function mapResultToResponse(result: ScanZeroMessagesResult) {
  return {
    guildName: result.guildName,
    csvPath: result.csvPath,
    zeroMessageCount: result.zeroMessageUsers.length,
    totalMembersChecked: result.totalMembersChecked,
    totalMessagesScanned: result.totalMessagesScanned,
    skippedChannels: result.skippedChannels,
    processedChannels: result.processedChannels,
    previewNames: result.previewNames,
    moreCount: result.moreCount,
    skippedPreview: result.skippedPreview,
  };
}
