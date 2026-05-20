import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeUserCsv } from "./userCsv";

test("writeUserCsv can create date-versioned filenames", async () => {
  const originalCsvDirectory = process.env.CSV_DIRECTORY;
  const originalCsvStorageDriver = process.env.CSV_STORAGE_DRIVER;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "user-csv-"));

  process.env.CSV_DIRECTORY = directory;
  delete process.env.CSV_STORAGE_DRIVER;

  try {
    const scope = {
      discordUserId: "222222222222222222",
      guildId: "111111111111111111",
    };

    const firstPath = await writeUserCsv(
      "users-with-zero-messages",
      [],
      scope,
      ["User ID", "Username"],
      { filenameStyle: "date-version" },
    );
    const secondPath = await writeUserCsv(
      "users-with-zero-messages",
      [],
      scope,
      ["User ID", "Username"],
      { filenameStyle: "date-version" },
    );

    assert.match(
      path.basename(firstPath),
      /^users-with-zero-messages-\d{8}-v-1\.csv$/,
    );
    assert.match(
      path.basename(secondPath),
      /^users-with-zero-messages-\d{8}-v-2\.csv$/,
    );
  } finally {
    if (originalCsvDirectory === undefined) {
      delete process.env.CSV_DIRECTORY;
    } else {
      process.env.CSV_DIRECTORY = originalCsvDirectory;
    }

    if (originalCsvStorageDriver === undefined) {
      delete process.env.CSV_STORAGE_DRIVER;
    } else {
      process.env.CSV_STORAGE_DRIVER = originalCsvStorageDriver;
    }

    await fs.rm(directory, { force: true, recursive: true });
  }
});
