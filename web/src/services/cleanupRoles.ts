import type { ApiError, CleanupRolesRequest, CleanupRolesResponse } from "../models/types";

export const requestRoleCleanup = async (
  payload?: CleanupRolesRequest,
): Promise<CleanupRolesResponse> => {
  const response = await fetch("/api/cleanup-roles", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload ?? {}),
  });

  if (!response.ok) {
    let message = "Failed to clean up roles.";
    try {
      const errorPayload: ApiError = await response.json();
      message = errorPayload.message ?? message;
    } catch {
      // Ignore parsing issues and fall back to default message.
    }
    throw new Error(message);
  }

  const data: CleanupRolesResponse = await response.json();
  return data;
};
