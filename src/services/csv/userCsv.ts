import {
  listScopedCsvFiles,
  writeScopedCsvFile,
  type CsvOwnerScope,
} from "./csvStorage";

type UserCsvOptions = {
  filenameStyle?: "timestamp" | "date-version";
};

export const writeUserCsv = async (
  prefix: string,
  rows: string[][],
  scope: CsvOwnerScope,
  headers: string[] = ["User ID", "Username"],
  options: UserCsvOptions = {},
): Promise<string> => {
  const filename =
    options.filenameStyle === "date-version"
      ? await dateVersionedCsvFilename(prefix, scope)
      : datedCsvFilename(prefix);

  const lines = [headers, ...rows].map((columns) =>
    columns.map(escapeCsvCell).join(","),
  );

  const contents = lines.join("\n");
  return writeScopedCsvFile(filename, contents, scope);
};

const csvDate = (): string => {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
};

const datedCsvFilename = (prefix: string): string => {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}-${csvDate()}-${time}.csv`;
};

const dateVersionedCsvFilename = async (
  prefix: string,
  scope: CsvOwnerScope,
): Promise<string> => {
  const date = csvDate();
  const filenamePattern = new RegExp(
    `^${escapeRegExp(prefix)}-${date}-v-(\\d+)\\.csv$`,
  );
  const files = await listScopedCsvFiles(scope);
  const latestVersion = files.reduce((latest, file) => {
    const match = filenamePattern.exec(file.filename);
    if (!match) {
      return latest;
    }

    const version = Number(match[1]);
    return Number.isSafeInteger(version) ? Math.max(latest, version) : latest;
  }, 0);

  return `${prefix}-${date}-v-${latestVersion + 1}.csv`;
};

const escapeCsvCell = (cell: string): string => {
  if (cell.includes('"') || cell.includes(",") || cell.includes("\n")) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
