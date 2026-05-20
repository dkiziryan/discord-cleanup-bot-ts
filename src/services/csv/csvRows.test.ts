import test from "node:test";
import assert from "node:assert/strict";

import { buildCsvRowsPage } from "./csvRows";

const csv = [
  "User ID,Username,Last Activity Type",
  "1,Ada Lovelace,none",
  "2,Grace Hopper,message",
  "3,Katherine Johnson,reaction",
  "4,Radia Perlman,none",
].join("\n");

test("buildCsvRowsPage returns the requested page", () => {
  const page = buildCsvRowsPage("users.csv", csv, {
    page: 2,
    pageSize: 2,
  });

  assert.equal(page.filename, "users.csv");
  assert.deepEqual(page.columns, [
    "User ID",
    "Username",
    "Last Activity Type",
  ]);
  assert.equal(page.page, 2);
  assert.equal(page.pageSize, 2);
  assert.equal(page.totalRows, 4);
  assert.equal(page.totalPages, 2);
  assert.deepEqual(
    page.rows.map((row) => row.Username),
    ["Katherine Johnson", "Radia Perlman"],
  );
});

test("buildCsvRowsPage filters usernames case-insensitively", () => {
  const page = buildCsvRowsPage("users.csv", csv, {
    pageSize: 25,
    search: "AD",
  });

  assert.equal(page.totalRows, 2);
  assert.equal(page.totalPages, 1);
  assert.deepEqual(
    page.rows.map((row) => row.Username),
    ["Ada Lovelace", "Radia Perlman"],
  );
});

test("buildCsvRowsPage clamps invalid pagination options", () => {
  const page = buildCsvRowsPage("users.csv", csv, {
    page: "999",
    pageSize: "invalid",
  });

  assert.equal(page.page, 1);
  assert.equal(page.pageSize, 25);
  assert.equal(page.totalPages, 1);
});
