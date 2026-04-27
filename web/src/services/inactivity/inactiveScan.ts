import { apiVoid } from "../apiClient";

export const requestInactiveScan = async (payload: {
  days: number;
  excludedCategories?: string[];
  countReactionsAsActivity?: boolean;
}): Promise<void> =>
  apiVoid("/api/inactive-scan", {
    allowedStatuses: [202],
    errorMessage: "Failed to scan for inactive members.",
    method: "POST",
    json: payload,
  });
