import { promises as fs } from "fs";
import path from "path";

const DEFAULT_TARGET_CHANNELS: TargetChannelNames = [];

const CHANNELS_FILE_PATH = path.resolve(process.cwd(), "config", "targetChannels.json");
const LOCAL_CHANNELS_FILE_PATH = path.resolve(
  process.cwd(),
  "config",
  "targetChannels.local.json",
);

export type TargetChannelNames = string[];

export const getConfiguredTargetChannelsGuildId = (): string | null => {
  const configuredGuildId =
    process.env.TARGET_CHANNELS_GUILD_ID ?? process.env.DISCORD_GUILD_ID ?? "";
  const trimmed = configuredGuildId.trim();

  return trimmed.length > 0 ? trimmed : null;
};

export const canUseConfiguredChannelNames = (guildId: string): boolean => {
  const configuredGuildId = getConfiguredTargetChannelsGuildId();

  return Boolean(configuredGuildId && guildId === configuredGuildId);
};

export const applyConfiguredChannelScope = (
  guildId: string,
  channels: TargetChannelNames,
): TargetChannelNames => {
  if (!canUseConfiguredChannelNames(guildId)) {
    return [];
  }

  return [...channels];
};

const loadChannelNames = async (filePath: string): Promise<TargetChannelNames | null> => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) {
      return parsed.map((value) => value.trim()).filter(Boolean);
    }
  } catch (error) {
    // Ignore read/parse issues; fall through to the next source.
  }

  return null;
};

export const readConfiguredChannelNames = async (
  guildId?: string,
): Promise<TargetChannelNames> => {
  if (guildId && !canUseConfiguredChannelNames(guildId)) {
    return [];
  }

  const localChannels = await loadChannelNames(LOCAL_CHANNELS_FILE_PATH);
  if (localChannels) {
    return localChannels;
  }

  const sharedChannels = await loadChannelNames(CHANNELS_FILE_PATH);
  if (sharedChannels) {
    return sharedChannels;
  }

  return [...DEFAULT_TARGET_CHANNELS];
};

export const getDefaultChannelNames = (): TargetChannelNames => {
  return [...DEFAULT_TARGET_CHANNELS];
};

export { CHANNELS_FILE_PATH, LOCAL_CHANNELS_FILE_PATH };
