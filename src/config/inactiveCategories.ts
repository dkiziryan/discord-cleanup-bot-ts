import { promises as fs, readFileSync } from "fs";
import path from "path";

type CategoryList = string[];

const BUILTIN_INACTIVE_CATEGORIES: CategoryList = [];

const INACTIVE_FILE_PATH = path.resolve(process.cwd(), "config", "inactiveCategories.json");
const INACTIVE_LOCAL_FILE_PATH = path.resolve(
  process.cwd(),
  "config",
  "inactiveCategories.local.json",
);

export const getConfiguredInactiveCategoriesGuildId = (): string | null => {
  const configuredGuildId =
    process.env.INACTIVE_CATEGORIES_GUILD_ID ?? process.env.DISCORD_GUILD_ID ?? "";
  const trimmed = configuredGuildId.trim();

  return trimmed.length > 0 ? trimmed : null;
};

export const canUseConfiguredInactiveCategories = (guildId: string): boolean => {
  const configuredGuildId = getConfiguredInactiveCategoriesGuildId();

  return Boolean(configuredGuildId && guildId === configuredGuildId);
};

export const applyConfiguredInactiveCategoryScope = (
  guildId: string,
  categories: CategoryList,
): CategoryList => {
  if (!canUseConfiguredInactiveCategories(guildId)) {
    return [];
  }

  return [...categories];
};

const loadCategoryFile = async (filePath: string): Promise<CategoryList | null> => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed.map((value) => value.trim()).filter((value) => value.length > 0);
    }
  } catch {
    // Ignore errors and fall through to other data sources.
  }
  return null;
};

let cachedCategories: CategoryList | null = null;

export const readInactiveCategoryDefaults = async (
  guildId?: string,
): Promise<CategoryList> => {
  if (guildId && !canUseConfiguredInactiveCategories(guildId)) {
    return [];
  }

  if (cachedCategories) {
    return [...cachedCategories];
  }

  const local = await loadCategoryFile(INACTIVE_LOCAL_FILE_PATH);
  if (local) {
    cachedCategories = local;
    return [...cachedCategories];
  }

  const shared = await loadCategoryFile(INACTIVE_FILE_PATH);
  if (shared) {
    cachedCategories = shared;
    return [...cachedCategories];
  }

  cachedCategories = [...BUILTIN_INACTIVE_CATEGORIES];
  return [...cachedCategories];
};

export const getInactiveCategoryDefaultsSync = (): CategoryList => {
  if (cachedCategories) {
    return [...cachedCategories];
  }

  const loadSync = (filePath: string): CategoryList | null => {
    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        return parsed.map((value) => value.trim()).filter((value) => value.length > 0);
      }
    } catch {
      // Ignore and fall through.
    }
    return null;
  };

  cachedCategories =
    loadSync(INACTIVE_LOCAL_FILE_PATH) ??
    loadSync(INACTIVE_FILE_PATH) ??
    [...BUILTIN_INACTIVE_CATEGORIES];

  return [...cachedCategories];
};

export const clearInactiveCategoryCache = () => {
  cachedCategories = null;
};

export const INACTIVE_CATEGORY_FILE_PATH = INACTIVE_FILE_PATH;
export const INACTIVE_CATEGORY_LOCAL_FILE_PATH = INACTIVE_LOCAL_FILE_PATH;
