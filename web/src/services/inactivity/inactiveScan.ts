import type { InactiveScanResponse } from "../../models/types";
import { apiJson } from "../apiClient";

export const requestInactiveScan = async (payload: {
  days: number;
  excludedCategories?: string[];
  countReactionsAsActivity?: boolean;
}): Promise<InactiveScanResponse> =>
  apiJson<InactiveScanResponse>("/api/inactive-scan", {
    errorMessage: "Failed to scan for inactive members.",
    method: "POST",
    json: payload,
  });
