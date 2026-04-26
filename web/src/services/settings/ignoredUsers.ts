import type {
  IgnoredUser,
  IgnoredUsersResponse,
  ImportIgnoredUsersResponse,
} from "../../models/types";
import { apiJson, apiVoid } from "../apiClient";

export const fetchIgnoredUsers = async (): Promise<IgnoredUsersResponse> =>
  apiJson<IgnoredUsersResponse>("/api/ignored-users", {
    errorMessage: "Failed to load ignored users.",
  });

export const addIgnoredUser = async (
  discordUserId: string,
): Promise<IgnoredUser> => {
  const payload = await apiJson<{ user: IgnoredUser }>("/api/ignored-users", {
    errorMessage: "Failed to add ignored user.",
    json: { discordUserId },
    method: "POST",
  });

  return payload.user;
};

export const removeIgnoredUser = async (
  discordUserId: string,
): Promise<void> =>
  apiVoid(`/api/ignored-users/${encodeURIComponent(discordUserId)}`, {
    errorMessage: "Failed to remove ignored user.",
    method: "DELETE",
  });

export const importIgnoredUsers = async (
  csvText: string,
): Promise<ImportIgnoredUsersResponse> =>
  apiJson<ImportIgnoredUsersResponse>("/api/ignored-users/import", {
    errorMessage: "Failed to import ignored users.",
    json: { csvText },
    method: "POST",
  });

export const ignoredUsersExportUrl = "/api/ignored-users/export";
