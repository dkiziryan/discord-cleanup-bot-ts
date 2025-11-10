import type { ApiError, ScanResponse, ZeroMessagesRequest } from "../models/types";

export const requestZeroMessageScan = async (
  payload: ZeroMessagesRequest,
): Promise<ScanResponse> => {
  const response = await fetch("/api/zero-messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorMessage = "Failed to run scan.";
    try {
      const errorPayload: ApiError = await response.json();
      errorMessage = errorPayload.message ?? errorMessage;
    } catch {
      // Ignore JSON parsing errors and use the default message.
    }
    throw new Error(errorMessage);
  }

  const data: ScanResponse = await response.json();
  return data;
};
