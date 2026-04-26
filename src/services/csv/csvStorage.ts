import { promises as fs } from "fs";
import type { Dirent } from "fs";
import crypto from "node:crypto";
import path from "path";

import type { CsvFileMetadata } from "../../models/types";

const DEFAULT_CSV_FILE_LIMIT_BYTES = 20 * 1024 * 1024;
const DEFAULT_CSV_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;
const S3_SERVICE = "s3";
const S3_ALGORITHM = "AWS4-HMAC-SHA256";

export type CsvOwnerScope = {
  guildId: string;
  discordUserId: string;
};

export type CsvStoredFile = {
  contents: string;
  filename: string;
  size: number;
};

export const getCsvBaseDirectory = (): string => {
  const configuredDirectory = process.env.CSV_DIRECTORY?.trim();
  return configuredDirectory
    ? path.resolve(configuredDirectory)
    : path.resolve(process.cwd(), "csv");
};

export const getCsvFileLimitBytes = (): number => {
  return readPositiveIntegerEnv(
    "CSV_FILE_LIMIT_BYTES",
    DEFAULT_CSV_FILE_LIMIT_BYTES,
  );
};

export const getCsvStorageLimitBytes = (): number => {
  return readPositiveIntegerEnv(
    "CSV_STORAGE_LIMIT_BYTES",
    DEFAULT_CSV_STORAGE_LIMIT_BYTES,
  );
};

export const getScopedCsvDirectory = (scope: CsvOwnerScope): string => {
  return path.join(
    getCsvBaseDirectory(),
    safePathSegment(scope.guildId, "guild ID"),
    safePathSegment(scope.discordUserId, "Discord user ID"),
  );
};

export const getScopedCsvStoragePath = (
  filename: string,
  scope: CsvOwnerScope,
): string => {
  const safeFilename = resolveCsvFilename(filename);
  if (getCsvStorageDriver() === "s3") {
    return getScopedCsvObjectKey(safeFilename, scope);
  }

  return path.join(getScopedCsvDirectory(scope), safeFilename);
};

export const writeScopedCsvFile = async (
  filename: string,
  contents: string,
  scope: CsvOwnerScope,
): Promise<string> => {
  const safeFilename = resolveCsvFilename(filename);
  const sizeBytes = Buffer.byteLength(contents, "utf8");
  assertCsvFileWithinLimit(sizeBytes);

  if (getCsvStorageDriver() === "s3") {
    const key = getScopedCsvObjectKey(safeFilename, scope);
    await putS3Object(key, contents, "text/csv; charset=utf-8");
    return key;
  }

  const csvDirectory = getScopedCsvDirectory(scope);
  await fs.mkdir(csvDirectory, { recursive: true });
  await ensureCsvStorageCapacity(sizeBytes);

  const filepath = path.join(csvDirectory, safeFilename);
  await fs.writeFile(filepath, contents, "utf8");

  return filepath;
};

export const readScopedCsvFile = async (
  filename: string,
  scope: CsvOwnerScope,
): Promise<CsvStoredFile> => {
  const safeFilename = resolveCsvFilename(filename);

  if (getCsvStorageDriver() === "s3") {
    const key = getScopedCsvObjectKey(safeFilename, scope);
    const object = await getS3Object(key);
    assertCsvFileWithinLimit(object.size);
    return {
      contents: object.body,
      filename: safeFilename,
      size: object.size,
    };
  }

  const csvDirectory = getScopedCsvDirectory(scope);
  await fs.mkdir(csvDirectory, { recursive: true });
  const filepath = path.resolve(csvDirectory, safeFilename);

  const relative = path.relative(csvDirectory, filepath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid CSV filename.");
  }

  try {
    const stats = await fs.stat(filepath);
    assertCsvFileWithinLimit(stats.size);
    return {
      contents: await fs.readFile(filepath, "utf8"),
      filename: safeFilename,
      size: stats.size,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`CSV file not found: ${filename}`);
    }
    throw error;
  }
};

export const listScopedCsvFiles = async (
  scope: CsvOwnerScope,
): Promise<CsvFileMetadata[]> => {
  if (getCsvStorageDriver() === "s3") {
    const files = await listS3CsvFiles(scope);
    files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return files;
  }

  const csvDirectory = getScopedCsvDirectory(scope);
  await fs.mkdir(csvDirectory, { recursive: true });
  const entries = await fs.readdir(csvDirectory, { withFileTypes: true });

  const csvFiles = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".csv"),
  );

  const metadata = await Promise.all(
    csvFiles.map(async (entry) => {
      const filepath = path.join(csvDirectory, entry.name);
      const stats = await fs.stat(filepath);
      const contents = await fs.readFile(filepath, "utf8");
      return {
        filename: entry.name,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        rowCount: countCsvRows(contents),
      };
    }),
  );

  metadata.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return metadata;
};

export const ensureCsvStorageCapacity = async (
  bytesToAdd: number,
): Promise<void> => {
  const storageLimitBytes = getCsvStorageLimitBytes();
  const currentSizeBytes = await calculateDirectorySize(getCsvBaseDirectory());

  if (currentSizeBytes + bytesToAdd > storageLimitBytes) {
    throw new Error(
      `CSV storage limit exceeded. Current usage is ${currentSizeBytes} bytes and the limit is ${storageLimitBytes} bytes.`,
    );
  }
};

export const assertCsvFileWithinLimit = (sizeBytes: number): void => {
  const fileLimitBytes = getCsvFileLimitBytes();
  if (sizeBytes > fileLimitBytes) {
    throw new Error(
      `CSV file is ${sizeBytes} bytes and exceeds the ${fileLimitBytes} byte limit.`,
    );
  }
};

export const resolveCsvFilename = (filename: string): string => {
  const trimmed = filename.trim();
  if (
    !trimmed ||
    trimmed.includes("\\") ||
    trimmed !== path.basename(trimmed) ||
    !trimmed.endsWith(".csv")
  ) {
    throw new Error("Invalid CSV filename.");
  }

  return trimmed;
};

export const countCsvRows = (contents: string): number => {
  const lines = contents
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length <= 1) {
    return 0;
  }
  return lines.length - 1;
};

const getCsvStorageDriver = (): "local" | "s3" => {
  return process.env.CSV_STORAGE_DRIVER?.trim().toLowerCase() === "s3"
    ? "s3"
    : "local";
};

const getScopedCsvObjectKey = (
  filename: string,
  scope: CsvOwnerScope,
): string => {
  return [
    "csv",
    safePathSegment(scope.guildId, "guild ID"),
    safePathSegment(scope.discordUserId, "Discord user ID"),
    filename,
  ].join("/");
};

const calculateDirectorySize = async (directory: string): Promise<number> => {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw error;
  }

  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const filepath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return calculateDirectorySize(filepath);
      }
      if (!entry.isFile()) {
        return 0;
      }

      const stats = await fs.stat(filepath);
      return stats.size;
    }),
  );

  return sizes.reduce((total, size) => total + size, 0);
};

const readPositiveIntegerEnv = (
  variableName: string,
  defaultValue: number,
): number => {
  const rawValue = process.env[variableName]?.trim();
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number(rawValue);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : defaultValue;
};

const safePathSegment = (value: string, label: string): string => {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }

  return value;
};

type S3Config = {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  forcePathStyle: boolean;
  region: string;
  secretAccessKey: string;
};

type S3RequestOptions = {
  body?: string;
  contentType?: string;
  method: "GET" | "PUT";
  query?: Record<string, string>;
};

const getS3Config = (): S3Config => {
  const bucket = requiredEnv("S3_BUCKET");
  const region = process.env.S3_REGION?.trim() || "us-east-1";
  const endpoint =
    process.env.S3_ENDPOINT?.trim() || `https://s3.${region}.amazonaws.com`;

  return {
    accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"),
    bucket,
    endpoint: endpoint.replace(/\/+$/, ""),
    forcePathStyle:
      process.env.S3_FORCE_PATH_STYLE?.trim().toLowerCase() === "true" ||
      Boolean(process.env.S3_ENDPOINT?.trim()),
    region,
    secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY"),
  };
};

const putS3Object = async (
  key: string,
  body: string,
  contentType: string,
): Promise<void> => {
  const response = await signedS3Request(key, {
    body,
    contentType,
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error(await buildS3ErrorMessage(response, "upload CSV"));
  }
};

const getS3Object = async (
  key: string,
): Promise<{ body: string; size: number }> => {
  const response = await signedS3Request(key, { method: "GET" });
  if (response.status === 404) {
    throw new Error(`CSV file not found: ${path.basename(key)}`);
  }
  if (!response.ok) {
    throw new Error(await buildS3ErrorMessage(response, "download CSV"));
  }

  const body = await response.text();
  return {
    body,
    size: Buffer.byteLength(body, "utf8"),
  };
};

const listS3CsvFiles = async (
  scope: CsvOwnerScope,
): Promise<CsvFileMetadata[]> => {
  const prefix = `csv/${safePathSegment(scope.guildId, "guild ID")}/${safePathSegment(
    scope.discordUserId,
    "Discord user ID",
  )}/`;
  const response = await signedS3Request("", {
    method: "GET",
    query: {
      "list-type": "2",
      prefix,
    },
  });

  if (!response.ok) {
    throw new Error(await buildS3ErrorMessage(response, "list CSV files"));
  }

  const xml = await response.text();
  const listedFiles = Array.from(xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g))
    .map((match) => {
      const contents = match[1];
      const key = readXmlValue(contents, "Key");
      const filename = path.basename(key);
      return {
        filename,
        modifiedAt: readXmlValue(contents, "LastModified"),
        rowCount: 0,
        size: Number(readXmlValue(contents, "Size")) || 0,
      };
    })
    .filter((file) => file.filename.endsWith(".csv"));

  return Promise.all(
    listedFiles.map(async (file) => {
      const object = await getS3Object(`${prefix}${file.filename}`);
      return {
        ...file,
        rowCount: countCsvRows(object.body),
      };
    }),
  );
};

const signedS3Request = async (
  key: string,
  options: S3RequestOptions,
): Promise<Response> => {
  const config = getS3Config();
  const body = options.body ?? "";
  const payloadHash = sha256Hex(body);
  const requestDate = new Date();
  const amzDate = toAmzDate(requestDate);
  const dateStamp = amzDate.slice(0, 8);
  const url = buildS3Url(config, key);

  Object.entries(options.query ?? {}).forEach(([name, value]) => {
    url.searchParams.set(name, value);
  });

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (options.contentType) {
    headers["content-type"] = options.contentType;
  }

  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name]}\n`)
    .join("");
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalRequest = [
    options.method,
    url.pathname,
    canonicalQueryString(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${config.region}/${S3_SERVICE}/aws4_request`;
  const stringToSign = [
    S3_ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = getSignatureKey(
    config.secretAccessKey,
    dateStamp,
    config.region,
    S3_SERVICE,
  );
  const signature = hmacHex(signingKey, stringToSign);

  headers.authorization = `${S3_ALGORITHM} Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url, {
    body: options.method === "PUT" ? body : undefined,
    headers,
    method: options.method,
  });
};

const buildS3Url = (config: S3Config, key: string): URL => {
  const encodedKey = encodeS3Key(key);
  if (config.forcePathStyle) {
    return new URL(
      `/${encodeURIComponent(config.bucket)}${encodedKey ? `/${encodedKey}` : ""}`,
      config.endpoint,
    );
  }

  const url = new URL(config.endpoint);
  url.hostname = `${config.bucket}.${url.hostname}`;
  url.pathname = encodedKey ? `/${encodedKey}` : "/";
  return url;
};

const canonicalQueryString = (searchParams: URLSearchParams): string => {
  return Array.from(searchParams.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, value]) =>
        `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    )
    .join("&");
};

const encodeS3Key = (key: string): string => {
  return key.split("/").map(encodeURIComponent).join("/");
};

const readXmlValue = (xml: string, tagName: string): string => {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(
    new RegExp(`<${escapedTagName}>([\\s\\S]*?)<\\/${escapedTagName}>`),
  );
  return decodeXml(match?.[1] ?? "");
};

const decodeXml = (value: string): string => {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
};

const buildS3ErrorMessage = async (
  response: Response,
  action: string,
): Promise<string> => {
  const details = await response.text().catch(() => "");
  return `Failed to ${action}: S3 returned ${response.status}${details ? ` (${details.slice(0, 200)})` : ""}.`;
};

const requiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when CSV_STORAGE_DRIVER=s3.`);
  }
  return value;
};

const toAmzDate = (date: Date): string => {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
};

const sha256Hex = (value: string): string => {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
};

const hmac = (key: crypto.BinaryLike, value: string): Buffer => {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
};

const hmacHex = (key: crypto.BinaryLike, value: string): string => {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest("hex");
};

const getSignatureKey = (
  secretAccessKey: string,
  dateStamp: string,
  regionName: string,
  serviceName: string,
): Buffer => {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const dateRegionKey = hmac(dateKey, regionName);
  const dateRegionServiceKey = hmac(dateRegionKey, serviceName);
  return hmac(dateRegionServiceKey, "aws4_request");
};
