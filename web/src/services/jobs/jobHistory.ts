import type { JobHistoryItem, JobHistoryResponse } from "../../models/types";
import { apiJson } from "../apiClient";

export const fetchJobHistory = async (): Promise<JobHistoryItem[]> => {
  const payload = await apiJson<JobHistoryResponse>("/api/job-history", {
    errorMessage: "Failed to load activity history.",
  });

  return payload.jobs;
};
