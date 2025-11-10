import type { ScanStatus } from "../models/types";

export const fetchScanStatus = async (): Promise<ScanStatus | null> => {
  try {
    const response = await fetch("/api/scan-status");
    if (!response.ok) {
      return null;
    }

    const payload: ScanStatus = await response.json();
    return payload;
  } catch {
    return null;
  }
};
