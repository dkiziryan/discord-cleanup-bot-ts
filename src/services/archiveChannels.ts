import { ChannelType, type Client, type Guild, type GuildBasedChannel, type TextChannel } from "discord.js";

import type {
  ArchiveChannelsOptions,
  ArchiveChannelsResult,
  ArchivedChannelSummary,
} from "../models/types";

const ARCHIVE_CATEGORY_NAME = "🗄️ Archived";

export async function archiveInactiveChannels(
  client: Client,
  options: ArchiveChannelsOptions,
): Promise<ArchiveChannelsResult> {
  const { guildId, days, channelIds, dryRun = true, action = "archive", excludedCategories = [] } = options;

  if (days <= 0 || !Number.isFinite(days)) {
    throw new Error("Provide a positive number of days.");
  }

  if (action !== "archive" && action !== "delete") {
    throw new Error("Unsupported action. Use 'archive' or 'delete'.");
  }

  const guild = await client.guilds.fetch(guildId);

  if (dryRun) {
    const inactiveChannels = await findInactiveChannels(guild, days, excludedCategories);
    return {
      inactiveChannels,
      processedCount: 0,
      archiveCategoryId: action === "archive" ? await findArchiveCategoryId(guild, false) : null,
      action,
      failures: [],
    };
  }

  if (!channelIds || channelIds.length === 0) {
    throw new Error("Select at least one channel to archive.");
  }

  const archiveCategoryId = action === "archive" ? await ensureArchiveCategory(guild) : null;
  const failures: string[] = [];
  let processedCount = 0;

  for (const channelId of channelIds) {
    try {
      const guildChannel = await guild.channels.fetch(channelId);
      if (!isTextChannel(guildChannel)) {
        failures.push(`${channelId}: Channel not found or not a text channel.`);
        continue;
      }

      if (action === "archive") {
        if (guildChannel.parentId === archiveCategoryId) {
          continue;
        }
        await guildChannel.setParent(archiveCategoryId!, { lockPermissions: false });
      } else {
        await guildChannel.delete("Discord Cleanup Bot: delete inactive channel");
      }
      processedCount += 1;
    } catch (error) {
      failures.push(`${channelId}: ${(error as Error).message}`);
    }
  }

  return {
    inactiveChannels: [],
    processedCount,
    archiveCategoryId,
    action,
    failures,
  };
}

async function findInactiveChannels(
  guild: Guild,
  days: number,
  excludedCategories: string[],
): Promise<ArchivedChannelSummary[]> {
  const threshold = Date.now() - days * 24 * 60 * 60 * 1000;
  const excludedSet = new Set(
    excludedCategories.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0),
  );
  const summaries: ArchivedChannelSummary[] = [];

  for (const channel of guild.channels.cache.values()) {
    if (!isTextChannel(channel)) {
      continue;
    }

    const parentName = channel.parent?.name?.toLowerCase();
    if (parentName && excludedSet.has(parentName)) {
      continue;
    }

    if (channel.parent?.name?.toLowerCase() === ARCHIVE_CATEGORY_NAME.toLowerCase()) {
      continue;
    }

    try {
      const lastMessageAt = await fetchLastMessageTimestamp(channel);
      const effectiveTimestamp = lastMessageAt ?? channel.createdTimestamp ?? 0;

      if (effectiveTimestamp === 0) {
        continue;
      }

      if (effectiveTimestamp < threshold && channel.viewable) {
        summaries.push({
          id: channel.id,
          name: channel.name,
          lastMessageAt: lastMessageAt ? new Date(lastMessageAt).toISOString() : null,
        });
      }
    } catch {
      // Ignore channels the bot cannot read.
    }
  }

  summaries.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  return summaries;
}

async function fetchLastMessageTimestamp(channel: TextChannel): Promise<number | null> {
  try {
    const messages = await channel.messages.fetch({ limit: 1 });
    const lastMessage = messages.first();
    return lastMessage?.createdTimestamp ?? null;
  } catch {
    return null;
  }
}

function isTextChannel(channel: GuildBasedChannel | null): channel is TextChannel {
  return Boolean(channel && channel.type === ChannelType.GuildText);
}

async function ensureArchiveCategory(guild: Guild): Promise<string> {
  const existing = await findArchiveCategoryId(guild, true);
  if (existing) {
    return existing;
  }

  const created = await guild.channels.create({
    name: ARCHIVE_CATEGORY_NAME,
    type: ChannelType.GuildCategory,
    reason: "Discord Cleanup Bot: archive inactive channels",
  });
  return created.id;
}

async function findArchiveCategoryId(guild: Guild, refresh: boolean): Promise<string | null> {
  if (refresh) {
    await guild.channels.fetch();
  }

  const category = guild.channels.cache.find(
    (channel) => channel?.type === ChannelType.GuildCategory && channel.name === ARCHIVE_CATEGORY_NAME,
  );
  return category?.id ?? null;
}
