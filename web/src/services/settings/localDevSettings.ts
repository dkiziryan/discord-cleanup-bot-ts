import type { LocalDevSettings } from "../../models/types";
import { apiJson } from "../apiClient";

export const fetchLocalDevSettings = async (): Promise<LocalDevSettings> =>
  apiJson<LocalDevSettings>("/api/local-dev-settings", {
    errorMessage: "Failed to load local development settings.",
  });

export const updateLocalDevSettings = async (
  useProductionData: boolean,
): Promise<LocalDevSettings> =>
  apiJson<LocalDevSettings>("/api/local-dev-settings", {
    errorMessage: "Failed to update local development settings.",
    json: { useProductionData },
    method: "POST",
  });
