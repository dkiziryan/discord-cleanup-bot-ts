import type { ApiError } from "../models/types";

export const cancelKickJob = async (): Promise<void> => {
  const response = await fetch("/api/cancel-kick", { method: "POST" });
  if (!response.ok) {
    let message = "Failed to cancel kick job.";
    try {
      const payload: ApiError = await response.json();
      message = payload.message ?? message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
};
