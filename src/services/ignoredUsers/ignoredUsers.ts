import { promises as fs } from "fs";
import path from "path";

import { Prisma } from "@prisma/client";

import { parseCsvRows } from "../csv/csvInput";
import { getPrismaClient } from "../../utils/prismaClient";
import { shouldUseDatabaseIgnoredUsers } from "./ignoredUserSource";

export type IgnoredUserRecord = {
  id: string;
  discordGuildId: string;
  discordUserId: string;
  username: string | null;
  createdAt: Date;
};

export type IgnoredUserResponseItem = {
  id: string;
  discordUserId: string;
  username: string | null;
  createdAt: string;
};

export type ImportIgnoredUsersResult = {
  addedCount: number;
  skippedCount: number;
  totalCount: number;
};

const DISCORD_USER_ID_PATTERN = /^\d{5,25}$/;
const MAX_USERNAME_LENGTH = 120;
const LEGACY_IGNORE_DIRECTORY = path.resolve(process.cwd(), "ignore");
const LEGACY_IGNORE_FILE_PATH = path.join(
  LEGACY_IGNORE_DIRECTORY,
  "ignore-users.csv",
);

export const normalizeDiscordUserId = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return DISCORD_USER_ID_PATTERN.test(trimmed) ? trimmed : null;
};

export const listIgnoredUsers = async (
  guildId: string,
): Promise<IgnoredUserRecord[]> => {
  if (!shouldUseDatabaseIgnoredUsers()) {
    return listLegacyIgnoredUsers(guildId);
  }

  const prisma = await getPrismaClient();
  return prisma.guildIgnoredUser.findMany({
    orderBy: { createdAt: "desc" },
    where: { discordGuildId: guildId },
  }) as Promise<IgnoredUserRecord[]>;
};

export const loadIgnoredUserIds = async (
  guildId: string,
): Promise<Set<string>> => {
  const records = await listIgnoredUsers(guildId);
  return new Set(records.map((record) => record.discordUserId));
};

export const addIgnoredUser = async (
  guildId: string,
  discordUserId: string,
  username?: string | null,
): Promise<IgnoredUserRecord> => {
  const normalizedUserId = normalizeDiscordUserId(discordUserId);
  if (!normalizedUserId) {
    throw new Error("Provide a valid Discord user ID.");
  }
  const normalizedUsername = normalizeUsername(username);

  if (!shouldUseDatabaseIgnoredUsers()) {
    return addLegacyIgnoredUser(guildId, normalizedUserId, normalizedUsername);
  }

  const prisma = await getPrismaClient();
  return prisma.guildIgnoredUser.upsert({
    create: {
      discordGuildId: guildId,
      discordUserId: normalizedUserId,
      username: normalizedUsername,
    },
    update: {
      ...(normalizedUsername ? { username: normalizedUsername } : {}),
    },
    where: {
      discordGuildId_discordUserId: {
        discordGuildId: guildId,
        discordUserId: normalizedUserId,
      },
    },
  }) as Promise<IgnoredUserRecord>;
};

export const removeIgnoredUser = async (
  guildId: string,
  discordUserId: string,
): Promise<boolean> => {
  const normalizedUserId = normalizeDiscordUserId(discordUserId);
  if (!normalizedUserId) {
    throw new Error("Provide a valid Discord user ID.");
  }

  if (!shouldUseDatabaseIgnoredUsers()) {
    return removeLegacyIgnoredUser(discordUserId);
  }

  const prisma = await getPrismaClient();
  try {
    await prisma.guildIgnoredUser.delete({
      where: {
        discordGuildId_discordUserId: {
          discordGuildId: guildId,
          discordUserId: normalizedUserId,
        },
      },
    });
    return true;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return false;
    }

    throw error;
  }
};

export const importIgnoredUsers = async (
  guildId: string,
  input: { csvText?: string; discordUserIds?: string[] },
): Promise<ImportIgnoredUsersResult> => {
  const users = collectImportIgnoredUsers(input);
  if (users.length === 0) {
    throw new Error(
      'No valid Discord user IDs found. Use a CSV with a "User ID" column.',
    );
  }

  if (!shouldUseDatabaseIgnoredUsers()) {
    return importLegacyIgnoredUsers(guildId, users);
  }

  const prisma = await getPrismaClient();
  let addedCount = 0;
  let skippedCount = 0;

  for (const user of users) {
    try {
      await prisma.guildIgnoredUser.create({
        data: {
          discordGuildId: guildId,
          discordUserId: user.discordUserId,
          username: user.username,
        },
      });
      addedCount += 1;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        if (user.username) {
          await prisma.guildIgnoredUser.update({
            data: { username: user.username },
            where: {
              discordGuildId_discordUserId: {
                discordGuildId: guildId,
                discordUserId: user.discordUserId,
              },
            },
          });
        }
        skippedCount += 1;
        continue;
      }

      throw error;
    }
  }

  const totalCount = await prisma.guildIgnoredUser.count({
    where: { discordGuildId: guildId },
  });

  return { addedCount, skippedCount, totalCount };
};

export const mapIgnoredUserRecord = (
  record: IgnoredUserRecord,
): IgnoredUserResponseItem => ({
  id: record.id,
  discordUserId: record.discordUserId,
  username: record.username,
  createdAt: record.createdAt.toISOString(),
});

export const buildIgnoredUsersCsv = (
  records: IgnoredUserRecord[],
): string => {
  const rows = [
    ["User ID", "Username"],
    ...records.map((record) => [record.discordUserId, record.username ?? ""]),
  ];
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
};

export type IgnoredUserImportRow = {
  discordUserId: string;
  username: string | null;
};

export const collectImportIgnoredUsers = (input: {
  csvText?: string;
  discordUserIds?: string[];
}): IgnoredUserImportRow[] => {
  const users = new Map<string, IgnoredUserImportRow>();

  if (Array.isArray(input.discordUserIds)) {
    for (const id of input.discordUserIds) {
      const normalized = normalizeDiscordUserId(id);
      if (normalized) {
        users.set(normalized, { discordUserId: normalized, username: null });
      }
    }
  }

  if (input.csvText) {
    const rows = parseCsvRows(input.csvText);
    for (const row of rows) {
      const normalized = normalizeDiscordUserId(row["User ID"]);
      if (normalized) {
        users.set(normalized, {
          discordUserId: normalized,
          username: normalizeUsername(row.Username),
        });
      }
    }

    for (const line of input.csvText.split(/\r?\n/)) {
      const [candidate] = line.split(",");
      const normalized = normalizeDiscordUserId(candidate);
      if (normalized && !users.has(normalized)) {
        users.set(normalized, { discordUserId: normalized, username: null });
      }
    }
  }

  return Array.from(users.values());
};

export const collectImportUserIds = (input: {
  csvText?: string;
  discordUserIds?: string[];
}): string[] => {
  return collectImportIgnoredUsers(input).map((user) => user.discordUserId);
};

const normalizeUsername = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_USERNAME_LENGTH) : null;
};

const listLegacyIgnoredUsers = async (
  guildId: string,
): Promise<IgnoredUserRecord[]> => {
  const rows = await readLegacyIgnoredRows();
  return rows.map((row) => legacyRowToRecord(guildId, row));
};

const addLegacyIgnoredUser = async (
  guildId: string,
  discordUserId: string,
  username: string | null,
): Promise<IgnoredUserRecord> => {
  const rows = await readLegacyIgnoredRows();
  const existing = rows.find((row) => row.discordUserId === discordUserId);
  if (existing) {
    if (username) {
      existing.username = username;
      await writeLegacyIgnoredRows(rows);
    }
    return legacyRowToRecord(guildId, existing);
  }

  const row = { discordUserId, username };
  rows.unshift(row);
  await writeLegacyIgnoredRows(rows);
  return legacyRowToRecord(guildId, row);
};

const removeLegacyIgnoredUser = async (
  discordUserId: string,
): Promise<boolean> => {
  const rows = await readLegacyIgnoredRows();
  const nextRows = rows.filter((row) => row.discordUserId !== discordUserId);
  if (nextRows.length === rows.length) {
    return false;
  }

  await writeLegacyIgnoredRows(nextRows);
  return true;
};

const importLegacyIgnoredUsers = async (
  guildId: string,
  users: IgnoredUserImportRow[],
): Promise<ImportIgnoredUsersResult> => {
  const rows = await readLegacyIgnoredRows();
  const existing = new Map(rows.map((row) => [row.discordUserId, row]));
  let addedCount = 0;
  let skippedCount = 0;

  for (const user of users) {
    const row = existing.get(user.discordUserId);
    if (row) {
      if (user.username) {
        row.username = user.username;
      }
      skippedCount += 1;
      continue;
    }

    const nextRow = {
      discordUserId: user.discordUserId,
      username: user.username,
    };
    rows.push(nextRow);
    existing.set(user.discordUserId, nextRow);
    addedCount += 1;
  }

  await writeLegacyIgnoredRows(rows);
  const totalCount = (await listLegacyIgnoredUsers(guildId)).length;
  return { addedCount, skippedCount, totalCount };
};

type LegacyIgnoredRow = {
  discordUserId: string;
  username: string | null;
};

const readLegacyIgnoredRows = async (): Promise<LegacyIgnoredRow[]> => {
  try {
    const contents = await fs.readFile(LEGACY_IGNORE_FILE_PATH, "utf8");
    return collectImportIgnoredUsers({ csvText: contents });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
};

const writeLegacyIgnoredRows = async (
  rows: LegacyIgnoredRow[],
): Promise<void> => {
  await fs.mkdir(LEGACY_IGNORE_DIRECTORY, { recursive: true });
  const csv = [
    ["User ID", "Username"],
    ...rows.map((row) => [row.discordUserId, row.username ?? ""]),
  ]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
  await fs.writeFile(LEGACY_IGNORE_FILE_PATH, `${csv}\n`, "utf8");
};

const legacyRowToRecord = (
  guildId: string,
  row: LegacyIgnoredRow,
): IgnoredUserRecord => ({
  id: `legacy:${row.discordUserId}`,
  discordGuildId: guildId,
  discordUserId: row.discordUserId,
  username: row.username,
  createdAt: new Date(),
});

const escapeCsvCell = (cell: string): string => {
  if (cell.includes('"') || cell.includes(",") || cell.includes("\n")) {
    return `"${cell.replace(/"/g, '""')}"`;
  }

  return cell;
};
