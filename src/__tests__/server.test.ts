import test from "node:test";
import assert from "node:assert/strict";
import { parseChannelNames } from "../services/channel/channelInput";
import {
  getOriginFromUrl,
  isAllowedBrowserOrigin,
} from "../utils/runtimeChecks";

test("parseChannelNames splits string input on commas and newlines", () => {
  const parsed = parseChannelNames("general,announcements\nmods\r\nsupport");

  assert.deepEqual(parsed, ["general", "announcements", "mods", "support"]);
});

test("parseChannelNames does not split on the letter n", () => {
  const parsed = parseChannelNames("announcements");

  assert.deepEqual(parsed, ["announcements"]);
});

test("isAllowedBrowserOrigin permits localhost and configured origins", () => {
  assert.equal(isAllowedBrowserOrigin(undefined), true);
  assert.equal(isAllowedBrowserOrigin("http://localhost:5173"), true);
  assert.equal(isAllowedBrowserOrigin("http://127.0.0.1:4173"), true);
  assert.equal(
    isAllowedBrowserOrigin("https://discord-admin-console.example", [
      "https://discord-admin-console.example",
    ]),
    true,
  );
  assert.equal(isAllowedBrowserOrigin("http://192.168.1.20:5173"), false);
  assert.equal(isAllowedBrowserOrigin("https://localhost:5173"), false);
});

test("getOriginFromUrl returns origin for valid URLs only", () => {
  assert.equal(
    getOriginFromUrl(
      "https://discord-admin-console-production.up.railway.app/auth/discord/callback",
    ),
    "https://discord-admin-console-production.up.railway.app",
  );
  assert.equal(getOriginFromUrl("not-a-url"), null);
  assert.equal(getOriginFromUrl(undefined), null);
});
