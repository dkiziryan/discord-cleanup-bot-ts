import { promises as fs } from "fs";
import path from "path";
import type { Client, Guild, GuildMember } from "discord.js";
import { PermissionFlagsBits } from "discord.js";

import { formatDiscordName } from "./zeroMessageScanner";
import { ScanCancelledError } from "./errors";
import type { KickFromCsvFileResult, KickFromCsvRequest } from "../models/types";

const CSV_DIRECTORY = path.resolve(process.cwd(), "csv");
const IGNORE_DIRECTORY = path.resolve(process.cwd(), "ignore");
const KICK_DELAY_MS = 1000;

export async function kickMembersFromCsv(
  client: Client,
  guildId: string,
  options: KickFromCsvRequest & { isCancelled?: () => boolean },
): Promise<KickFromCsvFileResult[]> {
  const { filenames, dryRun = false, isCancelled } = options;
  if (filenames.length === 0) {
    throw new Error("At least one CSV filename must be provided.");
  }

  const throwIfCancelled = () => {
    if (isCancelled?.()) {
      throw new ScanCancelledError("Kick job cancelled by user.");
    }
  };

  const guild = await client.guilds.fetch(guildId);
  if (!guild) {
    throw new Error(`Guild ${guildId} not found.`);
  }

  const me = guild.members.me ?? (client.user ? await guild.members.fetch(client.user.id) : null);
  if (!me || !me.permissions.has(PermissionFlagsBits.KickMembers)) {
    throw new Error("Bot is missing the Kick Members permission in this guild.");
  }

  const ignoredUserIds = await loadIgnoredUserIds();

  const uniqFilenames = Array.from(new Set(filenames));
  const results: KickFromCsvFileResult[] = [];

  for (const filename of uniqFilenames) {
    throwIfCancelled();
    const csvPath = await resolveCsvPath(filename);
    const rows = await readCsvRows(csvPath);

    const summary: KickFromCsvFileResult = {
      filename,
      dryRun,
      totalRows: rows.length,
      matchedUsers: 0,
      attemptedKicks: 0,
      successfulKicks: 0,
      failures: [],
    };

    const matchedMembers: Array<{ member: GuildMember; username: string; userId: string }> = [];

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
        summary.failures.push(`Row ${rowIndex + 2}: User ID ${userId} not found in this guild.`);
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
}

async function resolveCsvPath(filename: string): Promise<string> {
  await fs.mkdir(CSV_DIRECTORY, { recursive: true });

  const normalizedInput = path.normalize(filename.trim());
  const withoutLeadingSlashes = normalizedInput.replace(/^[/\\]+/, "");
  const withoutCsvPrefix = withoutLeadingSlashes.startsWith(`csv${path.sep}`)
    ? withoutLeadingSlashes.slice(`csv${path.sep}`.length)
    : withoutLeadingSlashes;

  const candidate = path.isAbsolute(normalizedInput)
    ? normalizedInput
    : path.join(CSV_DIRECTORY, withoutCsvPrefix);
  const resolved = path.resolve(candidate);

  const relative = path.relative(CSV_DIRECTORY, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid CSV filename.");
  }

  try {
    await fs.access(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`CSV file not found: ${filename}`);
    }
    throw error;
  }
  return resolved;
}

type CsvRow = Record<string, string>;

async function readCsvRows(filepath: string): Promise<CsvRow[]> {
  const contents = await fs.readFile(filepath, "utf8");
  const lines = contents.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  const rows: CsvRow[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const values = parseCsvLine(lines[index]);
    const row: CsvRow = {};
    headers.forEach((header, headerIndex) => {
      row[header] = values[headerIndex] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

async function loadIgnoredUserIds(): Promise<Set<string>> {
  const ignored = new Set<string>();
  try {
    await fs.access(IGNORE_DIRECTORY);
  } catch {
    return ignored;
  }

  const entries = await fs.readdir(IGNORE_DIRECTORY, { withFileTypes: true });
  const csvFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".csv"));

  for (const entry of csvFiles) {
    const filepath = path.join(IGNORE_DIRECTORY, entry.name);
    try {
      const rows = await readCsvRows(filepath);
      for (const row of rows) {
        const userId = row["User ID"]?.trim();
        if (userId) {
          ignored.add(userId);
        }
      }
    } catch {
      // Skip unreadable ignore files.
    }
  }

  return ignored;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function normalizeUsername(value: string): string {
  const trimmed = value.trim();
  if (trimmed.endsWith("#0")) {
    return trimmed.slice(0, -2);
  }
  return trimmed;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

type FetchMemberResult =
  | { member: GuildMember; error: null }
  | { member: null; error: string };

async function fetchGuildMember(guild: Guild, userId: string): Promise<FetchMemberResult> {
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
      return { member: null, error: `User ID ${userId} not found in this guild.` };
    }

    return { member: null, error: `Failed to fetch user ${userId}: ${message}` };
  }
}
