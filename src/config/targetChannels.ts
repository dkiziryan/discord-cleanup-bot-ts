import { promises as fs } from "fs";
import path from "path";

const DEFAULT_TARGET_CHANNELS = [
  "in-between",
  "general",
  "ccp-discussion",
  "legit-and-price-check",
] as const;

const CHANNELS_FILE_PATH = path.resolve(process.cwd(), "config", "targetChannels.json");

export type TargetChannelNames = string[];

export async function readConfiguredChannelNames(): Promise<TargetChannelNames> {
  try {
    const raw = await fs.readFile(CHANNELS_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) {
      return parsed.map((value) => value.trim()).filter(Boolean);
    }
  } catch (error) {
    // Fall through to defaults when file is missing or malformed.
  }

  return [...DEFAULT_TARGET_CHANNELS];
}

export function getDefaultChannelNames(): TargetChannelNames {
  return [...DEFAULT_TARGET_CHANNELS];
}

export { CHANNELS_FILE_PATH };
