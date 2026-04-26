import { Prisma } from "@prisma/client";

import { parseCsvRows } from "../csv/csvInput";
import { getPrismaClient } from "../../utils/prismaClient";

export type IgnoredUserRecord = {
  id: string;
  discordGuildId: string;
  discordUserId: string;
  createdAt: Date;
};

export type IgnoredUserResponseItem = {
  id: string;
  discordUserId: string;
  createdAt: string;
};

export type ImportIgnoredUsersResult = {
  addedCount: number;
  skippedCount: number;
  totalCount: number;
};

const DISCORD_USER_ID_PATTERN = /^\d{5,25}$/;

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
): Promise<IgnoredUserRecord> => {
  const normalizedUserId = normalizeDiscordUserId(discordUserId);
  if (!normalizedUserId) {
    throw new Error("Provide a valid Discord user ID.");
  }

  const prisma = await getPrismaClient();
  return prisma.guildIgnoredUser.upsert({
    create: {
      discordGuildId: guildId,
      discordUserId: normalizedUserId,
    },
    update: {},
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
  const ids = collectImportUserIds(input);
  if (ids.length === 0) {
    throw new Error(
      'No valid Discord user IDs found. Use a CSV with a "User ID" column.',
    );
  }

  const prisma = await getPrismaClient();
  let addedCount = 0;
  let skippedCount = 0;

  for (const discordUserId of ids) {
    try {
      await prisma.guildIgnoredUser.create({
        data: {
          discordGuildId: guildId,
          discordUserId,
        },
      });
      addedCount += 1;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
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
  createdAt: record.createdAt.toISOString(),
});

export const buildIgnoredUsersCsv = (
  records: IgnoredUserRecord[],
): string => {
  const rows = [["User ID"], ...records.map((record) => [record.discordUserId])];
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
};

export const collectImportUserIds = (input: {
  csvText?: string;
  discordUserIds?: string[];
}): string[] => {
  const ids = new Set<string>();

  if (Array.isArray(input.discordUserIds)) {
    for (const id of input.discordUserIds) {
      const normalized = normalizeDiscordUserId(id);
      if (normalized) {
        ids.add(normalized);
      }
    }
  }

  if (input.csvText) {
    const rows = parseCsvRows(input.csvText);
    for (const row of rows) {
      const normalized = normalizeDiscordUserId(row["User ID"]);
      if (normalized) {
        ids.add(normalized);
      }
    }

    for (const line of input.csvText.split(/\r?\n/)) {
      const [candidate] = line.split(",");
      const normalized = normalizeDiscordUserId(candidate);
      if (normalized) {
        ids.add(normalized);
      }
    }
  }

  return Array.from(ids);
};

const escapeCsvCell = (cell: string): string => {
  if (cell.includes('"') || cell.includes(",") || cell.includes("\n")) {
    return `"${cell.replace(/"/g, '""')}"`;
  }

  return cell;
};
