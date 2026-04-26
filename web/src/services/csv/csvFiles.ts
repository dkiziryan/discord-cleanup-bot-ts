import type { CsvFileListResponse, CsvFileMetadata } from "../../models/types";
import { apiJson } from "../apiClient";

export const fetchCsvFiles = async (): Promise<CsvFileMetadata[]> => {
  const payload = await apiJson<CsvFileListResponse>("/api/csv-files", {
    errorMessage: "Failed to load CSV files.",
  });
  return payload.files;
};

export const buildCsvDownloadUrl = (filename: string): string =>
  `/api/csv-files/${encodeURIComponent(filename)}/download`;
