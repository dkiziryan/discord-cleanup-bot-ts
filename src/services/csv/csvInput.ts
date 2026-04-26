import { promises as fs } from "fs";

import {
  getScopedCsvStoragePath,
  readScopedCsvFile,
  type CsvOwnerScope,
} from "./csvStorage";

export type CsvRow = Record<string, string>;

export const resolveCsvPath = async (
  filename: string,
  scope: CsvOwnerScope,
): Promise<string> => {
  await readScopedCsvFile(filename, scope);
  return getScopedCsvStoragePath(filename, scope);
};

export const readCsvRows = async (filepath: string): Promise<CsvRow[]> => {
  const contents = await fs.readFile(filepath, "utf8");
  return parseCsvRows(contents);
};

export const readCsvRowsByFilename = async (
  filename: string,
  scope: CsvOwnerScope,
): Promise<CsvRow[]> => {
  const file = await readScopedCsvFile(filename, scope);
  return parseCsvRows(file.contents);
};

export const parseCsvRows = (contents: string): CsvRow[] => {
  const lines = contents.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  const rows: CsvRow[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const values = parseCsvLine(lines[index]);
    const row: CsvRow = {};
    headers.forEach((header, headerIndex) => {
      row[header] = values[headerIndex] ?? "";
    });
    rows.push(row);
  }

  return rows;
};

const parseCsvLine = (line: string): string[] => {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values.map((value) => value.trim());
};
