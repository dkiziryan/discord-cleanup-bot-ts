import test from "node:test";
import assert from "node:assert/strict";
import { parseChannelNames } from "../services/channel/channelInput";
import {
  applyConfiguredChannelScope,
  canUseConfiguredChannelNames,
} from "../config/targetChannels";
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

test("configured target channels are scoped to the configured guild", () => {
  const originalTargetGuildId = process.env.TARGET_CHANNELS_GUILD_ID;
  const originalDiscordGuildId = process.env.DISCORD_GUILD_ID;

  process.env.TARGET_CHANNELS_GUILD_ID = "guild-carol";
  process.env.DISCORD_GUILD_ID = "guild-fallback";

  try {
    assert.equal(canUseConfiguredChannelNames("guild-carol"), true);
    assert.equal(canUseConfiguredChannelNames("guild-boris"), false);
    assert.deepEqual(
      applyConfiguredChannelScope("guild-carol", ["general", "ccp-discussion"]),
      ["general", "ccp-discussion"],
    );
    assert.deepEqual(
      applyConfiguredChannelScope("guild-boris", ["general", "ccp-discussion"]),
      [],
    );
  } finally {
    if (originalTargetGuildId === undefined) {
      delete process.env.TARGET_CHANNELS_GUILD_ID;
    } else {
      process.env.TARGET_CHANNELS_GUILD_ID = originalTargetGuildId;
    }

    if (originalDiscordGuildId === undefined) {
      delete process.env.DISCORD_GUILD_ID;
    } else {
      process.env.DISCORD_GUILD_ID = originalDiscordGuildId;
    }
  }
});

test("configured target channels fall back to DISCORD_GUILD_ID", () => {
  const originalTargetGuildId = process.env.TARGET_CHANNELS_GUILD_ID;
  const originalDiscordGuildId = process.env.DISCORD_GUILD_ID;

  delete process.env.TARGET_CHANNELS_GUILD_ID;
  process.env.DISCORD_GUILD_ID = "guild-carol";

  try {
    assert.equal(canUseConfiguredChannelNames("guild-carol"), true);
    assert.equal(canUseConfiguredChannelNames("guild-coursehero"), false);
  } finally {
    if (originalTargetGuildId === undefined) {
      delete process.env.TARGET_CHANNELS_GUILD_ID;
    } else {
      process.env.TARGET_CHANNELS_GUILD_ID = originalTargetGuildId;
    }

    if (originalDiscordGuildId === undefined) {
      delete process.env.DISCORD_GUILD_ID;
    } else {
      process.env.DISCORD_GUILD_ID = originalDiscordGuildId;
    }
  }
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
