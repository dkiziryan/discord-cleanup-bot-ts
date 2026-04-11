const DEFAULT_SCAN_CHANNEL_CONCURRENCY = 3;
const MAX_SCAN_CHANNEL_CONCURRENCY = 5;

export const resolveScanChannelConcurrency = (
  value = process.env.SCAN_CHANNEL_CONCURRENCY,
): number => {
  if (!value) {
    return DEFAULT_SCAN_CHANNEL_CONCURRENCY;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return DEFAULT_SCAN_CHANNEL_CONCURRENCY;
  }

  return Math.min(parsed, MAX_SCAN_CHANNEL_CONCURRENCY);
};
