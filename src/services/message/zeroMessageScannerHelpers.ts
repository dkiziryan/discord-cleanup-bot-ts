import {
  ChannelType,
  type Client,
  type Guild,
  type TextChannel,
} from "discord.js";
import type { LastActivityType } from "../../models/types";

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
    countReactionsAsActivity?: boolean;
    lastActivityByMemberId?: Map<string, LastActivityType>;
    maxMessagesPerChannel?: number;
    onMemberProgress?: () => void;
    onCheckCancelled?: () => void;
  },
): Promise<{ totalMessages: number }> => {
  const {
    countReactionsAsActivity = false,
    lastActivityByMemberId,
    maxMessagesPerChannel,
    onMemberProgress,
    onCheckCancelled,
  } = options;
  let totalMessages = 0;
  let lastMessageId: string | undefined;

  const markReactionUsersAsActive = (
    users: Iterable<{ id: string; bot?: boolean | null }>,
  ) => {
    for (const user of users) {
      if (user.bot || !remainingIds.has(user.id)) {
        continue;
      }

      remainingIds.delete(user.id);
      lastActivityByMemberId?.set(user.id, "reaction");
      onMemberProgress?.();
    }
  };

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
      if (
        maxMessagesPerChannel !== undefined &&
        totalMessages >= maxMessagesPerChannel
      ) {
        break;
      }

      totalMessages += 1;

      if (!message.author.bot && remainingIds.has(message.author.id)) {
        remainingIds.delete(message.author.id);
        lastActivityByMemberId?.set(message.author.id, "message");
        onMemberProgress?.();
      }

      const reactions = message.reactions?.cache;
      if (countReactionsAsActivity && reactions && remainingIds.size > 0) {
        for (const reaction of reactions.values()) {
          onCheckCancelled?.();
          markReactionUsersAsActive(reaction.users.cache.values());

          if (remainingIds.size === 0) {
            break;
          }

          const reactionCount = reaction.count ?? reaction.users.cache.size;
          if (reaction.users.cache.size >= reactionCount) {
            continue;
          }

          const users = await reaction.users.fetch().catch(() => null);
          if (!users) {
            continue;
          }

          markReactionUsersAsActive(users.values());

          if (remainingIds.size === 0) {
            break;
          }
        }
      }

      if (remainingIds.size === 0) {
        break;
      }
    }

    if (remainingIds.size === 0) {
      break;
    }

    if (
      maxMessagesPerChannel !== undefined &&
      totalMessages >= maxMessagesPerChannel
    ) {
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
