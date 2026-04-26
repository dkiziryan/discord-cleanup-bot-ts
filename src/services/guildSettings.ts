import { Prisma } from "@prisma/client";
import { readInactiveCategoryDefaults } from "../config/inactiveCategories";
import {
  applyConfiguredChannelScope,
  readConfiguredChannelNames,
} from "../config/targetChannels";
import { getPrismaClient } from "../utils/prismaClient";
import { toStringArray } from "../utils/prismaJson";

export type GuildSettingsRecord = {
  discordGuildId: string;
  inactiveExcludedCategories: string[];
  defaultTargetChannels: string[];
};

const mapGuildSettings = (record: {
  discordGuildId: string;
  inactiveExcludedCategories: Prisma.JsonValue;
  defaultTargetChannels: Prisma.JsonValue;
}): GuildSettingsRecord => ({
  discordGuildId: record.discordGuildId,
  inactiveExcludedCategories: toStringArray(record.inactiveExcludedCategories),
  defaultTargetChannels: applyConfiguredChannelScope(
    record.discordGuildId,
    toStringArray(record.defaultTargetChannels),
  ),
});

export const ensureGuildSettings = async (
  guildId: string,
): Promise<GuildSettingsRecord> => {
  const prisma = await getPrismaClient();
  const defaultTargetChannels = await readConfiguredChannelNames(guildId);
  const inactiveExcludedCategories = await readInactiveCategoryDefaults();

  const settings = await prisma.guildSettings.upsert({
    where: { discordGuildId: guildId },
    update: {},
    create: {
      discordGuildId: guildId,
      defaultTargetChannels,
      inactiveExcludedCategories,
    },
  });

  return mapGuildSettings(settings);
};

export const readGuildSettings = async (
  guildId: string,
): Promise<GuildSettingsRecord> => {
  const prisma = await getPrismaClient();
  const settings = await prisma.guildSettings.findUnique({
    where: { discordGuildId: guildId },
  });

  if (!settings) {
    return ensureGuildSettings(guildId);
  }

  return mapGuildSettings(settings);
};

export const collectInactiveExcludedCategories = async (
  guildId: string,
  extra: string[] = [],
): Promise<string[]> => {
  const settings = await readGuildSettings(guildId);
  const envValue = process.env.INACTIVE_EXCLUDED_CATEGORIES ?? "";
  const envCategories = envValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return [...settings.inactiveExcludedCategories, ...extra, ...envCategories];
};
