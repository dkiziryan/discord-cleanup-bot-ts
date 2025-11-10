import type { CsvFileListResponse, CsvFileMetadata } from "../models/types";

export const fetchCsvFiles = async (): Promise<CsvFileMetadata[]> => {
  const response = await fetch("/api/csv-files");
  if (!response.ok) {
    throw new Error("Failed to load CSV files.");
  }

  const payload: CsvFileListResponse = await response.json();
  return payload.files;
};
