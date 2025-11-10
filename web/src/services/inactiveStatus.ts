import type { InactiveScanStatus } from "../models/types";

export const fetchInactiveStatus = async (): Promise<InactiveScanStatus | null> => {
  try {
    const response = await fetch("/api/inactive-status");
    if (!response.ok) {
      return null;
    }
    const data: InactiveScanStatus = await response.json();
    return data;
  } catch {
    return null;
  }
};
