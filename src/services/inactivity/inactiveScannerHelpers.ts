import {
  AnyThreadChannel,
  ChannelType,
  Collection,
  Guild,
  GuildMember,
  GuildTextBasedChannel,
} from "discord.js";
import { formatDiscordName } from "../../utils/discordMemberName";
import type { LastActivityType } from "../../models/types";

export const buildExcludedCategorySet = (categories: string[]): Set<string> => {
  return new Set(
    categories
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );
};

export const fetchGuild = async (
  client: { guilds: { fetch: (guildId: string) => Promise<Guild> } },
  guildId: string,
): Promise<Guild> => {
  const guild = await client.guilds.fetch(guildId);
  if (!guild) {
    throw new Error(`Guild ${guildId} not found.`);
  }
  return guild;
};

export const resolveTargetChannels = async (
  guild: Guild,
  excludedCategories: Set<string>,
  activeThreads: Collection<string, AnyThreadChannel> | null,
): Promise<GuildTextBasedChannel[]> => {
  const targets: GuildTextBasedChannel[] = [];
  const seen = new Set<string>();

  const considerChannel = (channel: unknown) => {
    const kind = (channel as { type?: ChannelType }).type;
    if (kind === ChannelType.GuildForum) {
      return;
    }

    if (
      !channel ||
      typeof (channel as GuildTextBasedChannel).isTextBased !== "function"
    ) {
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
      fetchActive?: () => Promise<{
        threads: Collection<string, AnyThreadChannel>;
      }>;
      fetchArchived?: (
        options?: Record<string, unknown>,
      ) => Promise<{ threads: Collection<string, AnyThreadChannel> }>;
    } | null;

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
      const publicArchived = await threadManager.fetchArchived?.({
        type: "public",
        limit: 100,
      });
      publicArchived?.threads?.forEach((thread) => considerChannel(thread));
    } catch {
      // ignore
    }

    try {
      const privateArchived = await threadManager.fetchArchived?.({
        type: "private",
        limit: 100,
      });
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
};

const resolveCategoryName = (
  channel: GuildTextBasedChannel | AnyThreadChannel,
): string | null => {
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
};

export const resolveGuildMe = async (
  guild: Guild,
): Promise<GuildMember | null> => {
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
};

export const scanChannelHistorySince = async (
  channel: GuildTextBasedChannel,
  cutoff: Date,
  remainingIds: Set<string>,
  options?: {
    countReactionsAsActivity?: boolean;
    lastActivityByMemberId?: Map<string, LastActivityType>;
    onCheckCancelled?: () => void;
  },
): Promise<{ totalMessages: number }> => {
  const onCheckCancelled = options?.onCheckCancelled;
  const countReactionsAsActivity = options?.countReactionsAsActivity ?? false;
  const lastActivityByMemberId = options?.lastActivityByMemberId;
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
        messageB.createdTimestamp - messageA.createdTimestamp,
    );

    for (const message of orderedMessages) {
      onCheckCancelled?.();
      if (message.createdTimestamp < cutoff.getTime()) {
        reachedCutoff = true;
        break;
      }

      totalMessages += 1;

      if (!message.author.bot && remainingIds.has(message.author.id)) {
        remainingIds.delete(message.author.id);
        lastActivityByMemberId?.set(message.author.id, "message");
      }

      const reactions = message.reactions?.cache;
      if (countReactionsAsActivity && reactions && remainingIds.size > 0) {
        for (const reaction of reactions.values()) {
          onCheckCancelled?.();
          const users = await reaction.users.fetch().catch(() => null);
          if (!users) {
            continue;
          }

          for (const user of users.values()) {
            if (user.bot || !remainingIds.has(user.id)) {
              continue;
            }

            remainingIds.delete(user.id);
            lastActivityByMemberId?.set(user.id, "reaction");
          }

          if (remainingIds.size === 0) {
            break;
          }
        }
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
};

export const extractMembers = (
  members: Map<string, GuildMember>,
  remainingIds: Set<string>,
): GuildMember[] => {
  const inactiveMembers = Array.from(remainingIds)
    .map((memberId) => members.get(memberId))
    .filter((maybeMember): maybeMember is GuildMember => Boolean(maybeMember));

  inactiveMembers.sort((a, b) =>
    formatDiscordName(a).localeCompare(formatDiscordName(b)),
  );
  return inactiveMembers;
};

export const buildSkippedPreview = (
  skippedChannels: string[],
  limit: number,
): string => {
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
