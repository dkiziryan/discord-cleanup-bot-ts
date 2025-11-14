import type { ApiError, ArchiveChannelsRequest, ArchiveChannelsResponse } from "../models/types";

export const requestArchiveChannels = async (
  payload: ArchiveChannelsRequest,
): Promise<ArchiveChannelsResponse> => {
  const response = await fetch("/api/inactive-channels", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = "Failed to archive channels.";
    try {
      const errorPayload: ApiError = await response.json();
      message = errorPayload.message ?? message;
    } catch {
      // Ignore JSON parse errors.
    }
    throw new Error(message);
  }

  const data: ArchiveChannelsResponse = await response.json();
  return data;
};
