export const parseChannelNames = (raw: unknown): string[] => {
  if (!raw) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0);
  }

  if (typeof raw === "string") {
    return raw
      .split(/[,\r\n]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  return [];
};
