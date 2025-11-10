import type { ApiError, InactiveScanResponse } from "../models/types";

export const requestInactiveScan = async (payload: {
  days: number;
  excludedCategories?: string[];
}): Promise<InactiveScanResponse> => {
  const response = await fetch("/api/inactive-scan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = "Failed to scan for inactive members.";
    try {
      const errorPayload: ApiError = await response.json();
      message = errorPayload.message ?? message;
    } catch {
      // Ignore parse errors.
    }
    throw new Error(message);
  }

  const data: InactiveScanResponse = await response.json();
  return data;
};
