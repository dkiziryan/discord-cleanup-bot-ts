import type { ApiError, KickFromCsvResponse } from "../models/types";

export const kickFromCsv = async (payload: {
  filenames: string[];
  dryRun: boolean;
}): Promise<KickFromCsvResponse> => {
  const response = await fetch("/api/kick-from-csv", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = "Failed to kick from CSV.";
    try {
      const errorPayload: ApiError = await response.json();
      message = errorPayload.message ?? message;
    } catch {
      // Ignore JSON parse errors
    }
    throw new Error(message);
  }

  const data: KickFromCsvResponse = await response.json();
  return data;
};
