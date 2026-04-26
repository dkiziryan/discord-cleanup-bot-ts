import test from "node:test";
import assert from "node:assert/strict";

import {
  collectImportUserIds,
  normalizeDiscordUserId,
} from "./ignoredUsers";

test("normalizeDiscordUserId accepts numeric Discord user IDs", () => {
  assert.equal(
    normalizeDiscordUserId(" 702612734893883434 "),
    "702612734893883434",
  );
});

test("normalizeDiscordUserId rejects invalid user IDs", () => {
  assert.equal(normalizeDiscordUserId("not-a-user-id"), null);
  assert.equal(normalizeDiscordUserId("1234"), null);
});

test("collectImportUserIds reads User ID CSV column and bare IDs", () => {
  const ids = collectImportUserIds({
    csvText:
      "User ID,Username\n702612734893883434,kiya\n1097864941719011358,piglet\n269963383028187136",
    discordUserIds: ["702612734893883434", "975825459742933002"],
  });

  assert.deepEqual(ids, [
    "702612734893883434",
    "975825459742933002",
    "1097864941719011358",
    "269963383028187136",
  ]);
});

test("collectImportUserIds accepts the current ignore-users CSV shape", () => {
  const ids = collectImportUserIds({
    csvText:
      "User ID,Username\n702612734893883434,kiya (kiya_self_edge)\n1097864941719011358, powerful_piglet_65232 (bsr)",
  });

  assert.deepEqual(ids, ["702612734893883434", "1097864941719011358"]);
});
