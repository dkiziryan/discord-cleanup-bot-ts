import type { ApiError } from "../models/types";

export const cancelScan = async (): Promise<void> => {
  const response = await fetch("/api/cancel-scan", {
    method: "POST",
  });

  if (!response.ok) {
    let message = "Failed to cancel scan.";
    try {
      const payload: ApiError = await response.json();
      message = payload.message ?? message;
    } catch {
      // Ignore JSON parsing errors.
    }
    throw new Error(message);
  }
};
