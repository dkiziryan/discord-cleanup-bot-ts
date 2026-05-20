import type {
  CsvFileListResponse,
  CsvFileMetadata,
  CsvRowsResponse,
} from "../../models/types";
import { apiJson } from "../apiClient";

export const fetchCsvFiles = async (): Promise<CsvFileMetadata[]> => {
  const payload = await apiJson<CsvFileListResponse>("/api/csv-files", {
    errorMessage: "Failed to load CSV files.",
  });
  return payload.files;
};

export const buildCsvDownloadUrl = (filename: string): string =>
  `/api/csv-files/${encodeURIComponent(filename)}/download`;

export const fetchCsvRows = async ({
  filename,
  page,
  pageSize,
  search,
}: {
  filename: string;
  page: number;
  pageSize: number;
  search: string;
}): Promise<CsvRowsResponse> => {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search.trim()) {
    params.set("search", search.trim());
  }

  return apiJson<CsvRowsResponse>(
    `/api/csv-files/${encodeURIComponent(filename)}/rows?${params.toString()}`,
    {
      errorMessage: "Failed to load CSV rows.",
    },
  );
};
