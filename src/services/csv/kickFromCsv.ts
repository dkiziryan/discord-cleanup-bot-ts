import type { Client, Guild, GuildMember } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import { KickFromCsvRequest, KickFromCsvFileResult } from "../../models/types";
import { formatDiscordName } from "../../utils/discordMemberName";
import { ScanCancelledError } from "../errors";
import { loadIgnoredUserIds } from "../ignoredUsers/ignoredUsers";
import { readCsvRowsByFilename } from "./csvInput";
import type { CsvOwnerScope } from "./csvStorage";

const KICK_DELAY_MS = 1000;

export const kickMembersFromCsv = async (
  client: Client,
  guildId: string,
  options: KickFromCsvRequest & {
    discordUserId: string;
    isCancelled?: () => boolean;
  },
): Promise<KickFromCsvFileResult[]> => {
  const { filenames, dryRun = false, discordUserId, isCancelled } = options;
  if (filenames.length === 0) {
    throw new Error("At least one CSV filename must be provided.");
  }

  const csvScope: CsvOwnerScope = { guildId, discordUserId };

  const throwIfCancelled = () => {
    if (isCancelled?.()) {
      throw new ScanCancelledError("Kick job cancelled by user.");
    }
  };

  const guild = await client.guilds.fetch(guildId);
  if (!guild) {
    throw new Error(`Guild ${guildId} not found.`);
  }

  const me =
    guild.members.me ??
    (client.user ? await guild.members.fetch(client.user.id) : null);
  if (!me || !me.permissions.has(PermissionFlagsBits.KickMembers)) {
    throw new Error(
      "Bot is missing the Kick Members permission in this guild.",
    );
  }

  const ignoredUserIds = await loadIgnoredUserIds(guildId);

  const uniqFilenames = Array.from(new Set(filenames));
  const results: KickFromCsvFileResult[] = [];

  for (const filename of uniqFilenames) {
    throwIfCancelled();
    const rows = await readCsvRowsByFilename(filename, csvScope);

    const summary: KickFromCsvFileResult = {
      filename,
      dryRun,
      totalRows: rows.length,
      matchedUsers: 0,
      attemptedKicks: 0,
      successfulKicks: 0,
      failures: [],
    };

    const matchedMembers: Array<{
      member: GuildMember;
      username: string;
      userId: string;
    }> = [];

    for (const [rowIndex, row] of rows.entries()) {
      throwIfCancelled();
      const userId = row["User ID"]?.trim();
      const username = row["Username"]?.trim();
      if (!userId || !username) {
        summary.failures.push(`Row ${rowIndex + 2}: Missing user data.`);
        continue;
      }

      if (ignoredUserIds.has(userId)) {
        continue;
      }

      const normalizedExpected = normalizeUsername(username);
      const memberResult = await fetchGuildMember(guild, userId);
      if (memberResult.error) {
        summary.failures.push(`Row ${rowIndex + 2}: ${memberResult.error}`);
        continue;
      }

      const member = memberResult.member;
      if (!member) {
        summary.failures.push(
          `Row ${rowIndex + 2}: User ID ${userId} not found in this guild.`,
        );
        continue;
      }

      const actualUsername = normalizeUsername(formatDiscordName(member));
      if (actualUsername !== normalizedExpected) {
        summary.failures.push(
          `Row ${rowIndex + 2}: Username mismatch (expected ${normalizedExpected}, got ${actualUsername}).`,
        );
        continue;
      }

      if (!member.kickable) {
        summary.failures.push(
          `Row ${rowIndex + 2}: Cannot kick ${actualUsername} due to role hierarchy or missing permission.`,
        );
        continue;
      }

      matchedMembers.push({ member, username: actualUsername, userId });
    }

    summary.matchedUsers = matchedMembers.length;
    summary.attemptedKicks = matchedMembers.length;

    if (dryRun) {
      results.push(summary);
      continue;
    }

    for (const [index, entry] of matchedMembers.entries()) {
      throwIfCancelled();
      try {
        await entry.member.kick("Kicked due to inactivity");
        const stillInGuild = await guild.members
          .fetch(entry.userId)
          .then(() => true)
          .catch((error: unknown) => {
            if ((error as { code?: number }).code === 10007) {
              // Unknown Member -> successfully kicked
              return false;
            }
            // If Discord returned something else, rethrow so we record it.
            throw error;
          });

        if (stillInGuild) {
          summary.failures.push(
            `Kick ${index + 1}/${matchedMembers.length} for ${entry.username} (${entry.userId}) reported success but user is still in the guild.`,
          );
        } else {
          summary.successfulKicks += 1;
        }
      } catch (error) {
        summary.failures.push(
          `Kick ${index + 1}/${matchedMembers.length} failed for ${entry.username} (${entry.userId}): ${(error as Error).message}`,
        );
      }

      if (index < matchedMembers.length - 1) {
        await delay(KICK_DELAY_MS);
      }
    }

    results.push(summary);
  }

  return results;
};

const normalizeUsername = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.endsWith("#0")) {
    return trimmed.slice(0, -2);
  }
  return trimmed;
};

const delay = (durationMs: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
};

type FetchMemberResult =
  | { member: GuildMember; error: null }
  | { member: null; error: string };

const fetchGuildMember = async (
  guild: Guild,
  userId: string,
): Promise<FetchMemberResult> => {
  const cached = guild.members.cache.get(userId);
  if (cached) {
    return { member: cached, error: null };
  }

  try {
    const fetched = await guild.members.fetch(userId);
    return { member: fetched, error: null };
  } catch (error) {
    const message = (error as Error).message ?? "Unknown error";
    if (message.includes("Members didn't arrive in time")) {
      return {
        member: null,
        error: `Failed to fetch user ${userId}: Members didn't arrive in time (Discord chunk timeout).`,
      };
    }

    const errorCode = (error as { code?: number }).code;
    if (errorCode === 10007) {
      // Unknown Member
      return {
        member: null,
        error: `User ID ${userId} not found in this guild.`,
      };
    }

    return {
      member: null,
      error: `Failed to fetch user ${userId}: ${message}`,
    };
  }
};
