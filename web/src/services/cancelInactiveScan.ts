import type { ApiError } from "../models/types";

export const cancelInactiveScan = async (): Promise<void> => {
  const response = await fetch("/api/cancel-inactive", { method: "POST" });
  if (!response.ok) {
    let message = "Failed to cancel inactive scan.";
    try {
      const payload: ApiError = await response.json();
      message = payload.message ?? message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
};
