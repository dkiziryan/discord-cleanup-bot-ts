import {
  writeScopedCsvFile,
  type CsvOwnerScope,
} from "./csvStorage";

export const writeUserCsv = async (
  prefix: string,
  rows: string[][],
  scope: CsvOwnerScope,
): Promise<string> => {
  const filename = datedCsvFilename(prefix);

  const lines = [["User ID", "Username"], ...rows].map((columns) =>
    columns.map(escapeCsvCell).join(","),
  );

  const contents = lines.join("\n");
  return writeScopedCsvFile(filename, contents, scope);
};

const datedCsvFilename = (prefix: string): string => {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}-${date}-${time}.csv`;
};

const escapeCsvCell = (cell: string): string => {
  if (cell.includes('"') || cell.includes(",") || cell.includes("\n")) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
};
