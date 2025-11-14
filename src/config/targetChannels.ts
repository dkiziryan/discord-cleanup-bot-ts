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

async function loadChannelNames(filePath: string): Promise<TargetChannelNames | null> {
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
}

export async function readConfiguredChannelNames(): Promise<TargetChannelNames> {
  const localChannels = await loadChannelNames(LOCAL_CHANNELS_FILE_PATH);
  if (localChannels) {
    return localChannels;
  }

  const sharedChannels = await loadChannelNames(CHANNELS_FILE_PATH);
  if (sharedChannels) {
    return sharedChannels;
  }

  return [...DEFAULT_TARGET_CHANNELS];
}

export function getDefaultChannelNames(): TargetChannelNames {
  return [...DEFAULT_TARGET_CHANNELS];
}

export { CHANNELS_FILE_PATH, LOCAL_CHANNELS_FILE_PATH };
