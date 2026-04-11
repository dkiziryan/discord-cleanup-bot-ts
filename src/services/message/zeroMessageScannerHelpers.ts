import {
  ChannelType,
  type Client,
  type Guild,
  type TextChannel,
} from "discord.js";

export const fetchGuild = async (client: Client, guildId: string): Promise<Guild> => {
  try {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) {
      throw new Error(`Guild ${guildId} not found.`);
    }
    return guild;
  } catch (error) {
    throw new Error(`Failed to fetch guild ${guildId}: ${(error as Error).message}`);
  }
};

export const resolveTargetChannels = (guild: Guild, channelNames: string[]): TextChannel[] => {
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
};

export const scanChannelHistory = async (
  channel: TextChannel,
  remainingIds: Set<string>,
  options: {
    onMemberProgress?: () => void;
    onCheckCancelled?: () => void;
  },
): Promise<{ totalMessages: number }> => {
  const { onMemberProgress, onCheckCancelled } = options;
  let totalMessages = 0;
  let lastMessageId: string | undefined;

  while (true) {
    onCheckCancelled?.();
    if (remainingIds.size === 0) {
      break;
    }

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
};

export const buildSkippedPreview = (skippedChannels: string[], limit: number): string => {
  if (skippedChannels.length === 0) {
    return "";
  }

  const shown = skippedChannels.slice(0, limit);
  let preview = shown.join(", ");
  if (skippedChannels.length > limit) {
    preview += `, +${skippedChannels.length - limit} more`;
  }
  return preview;
};
