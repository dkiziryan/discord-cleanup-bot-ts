import type { CsvRowsResponse } from "../../models/types";
import { parseCsvDocument } from "./csvInput";

export const DEFAULT_CSV_ROWS_PAGE_SIZE = 25;
export const MAX_CSV_ROWS_PAGE_SIZE = 100;

type CsvRowsPageOptions = {
  page?: unknown;
  pageSize?: unknown;
  search?: unknown;
};

export const buildCsvRowsPage = (
  filename: string,
  contents: string,
  options: CsvRowsPageOptions = {},
): CsvRowsResponse => {
  const { columns, rows } = parseCsvDocument(contents);
  const search =
    typeof options.search === "string" ? options.search.trim() : "";
  const normalizedSearch = search.toLowerCase();
  const filteredRows = normalizedSearch
    ? rows.filter((row) =>
        (row.Username ?? "").toLowerCase().includes(normalizedSearch),
      )
    : rows;
  const pageSize = parsePositiveInteger(
    options.pageSize,
    DEFAULT_CSV_ROWS_PAGE_SIZE,
    MAX_CSV_ROWS_PAGE_SIZE,
  );
  const totalRows = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const requestedPage = parsePositiveInteger(options.page, 1, totalPages);
  const page = Math.min(requestedPage, totalPages);
  const startIndex = (page - 1) * pageSize;

  return {
    columns,
    filename,
    page,
    pageSize,
    rows: filteredRows.slice(startIndex, startIndex + pageSize),
    search,
    totalPages,
    totalRows,
  };
};

const parsePositiveInteger = (
  value: unknown,
  fallback: number,
  max: number,
): number => {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed =
    typeof rawValue === "string" || typeof rawValue === "number"
      ? Number(rawValue)
      : NaN;

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, max);
};
