import test from "node:test";
import assert from "node:assert/strict";

import { resolveScanChannelConcurrency } from "../../utils/scanConcurrency";
import { scanChannelHistory } from "./zeroMessageScannerHelpers";

test("resolveScanChannelConcurrency defaults to three channels", () => {
  assert.equal(resolveScanChannelConcurrency(undefined), 3);
});

test("resolveScanChannelConcurrency allows five channels", () => {
  assert.equal(resolveScanChannelConcurrency("5"), 5);
});

test("resolveScanChannelConcurrency caps values above five", () => {
  assert.equal(resolveScanChannelConcurrency("10"), 5);
});

test("resolveScanChannelConcurrency ignores invalid values", () => {
  assert.equal(resolveScanChannelConcurrency("abc"), 3);
});

test("scanChannelHistory uses cached reaction users without fetching when cache is complete", async () => {
  let reactionFetchCount = 0;
  const remainingIds = new Set(["member-reactive"]);
  const lastActivityByMemberId = new Map<string, string>();
  const channel = createTextChannel([
    {
      id: "message-1",
      author: { bot: true, id: "bot-user" },
      createdTimestamp: 100,
      reactions: {
        cache: new Map([
          [
            "reaction-1",
            {
              count: 1,
              users: {
                cache: new Map([
                  ["member-reactive", { id: "member-reactive", bot: false }],
                ]),
                fetch: async () => {
                  reactionFetchCount += 1;
                  return new Map();
                },
              },
            },
          ],
        ]),
      },
    },
  ]);

  await scanChannelHistory(channel as never, remainingIds, {
    countReactionsAsActivity: true,
    lastActivityByMemberId: lastActivityByMemberId as never,
  });

  assert.equal(reactionFetchCount, 0);
  assert.equal(remainingIds.size, 0);
  assert.equal(lastActivityByMemberId.get("member-reactive"), "reaction");
});

test("scanChannelHistory fetches reaction users when cache is incomplete", async () => {
  let reactionFetchCount = 0;
  const remainingIds = new Set(["member-reactive"]);
  const lastActivityByMemberId = new Map<string, string>();
  const channel = createTextChannel([
    {
      id: "message-1",
      author: { bot: true, id: "bot-user" },
      createdTimestamp: 100,
      reactions: {
        cache: new Map([
          [
            "reaction-1",
            {
              count: 1,
              users: {
                cache: new Map(),
                fetch: async () => {
                  reactionFetchCount += 1;
                  return new Map([
                    [
                      "member-reactive",
                      { id: "member-reactive", bot: false },
                    ],
                  ]);
                },
              },
            },
          ],
        ]),
      },
    },
  ]);

  await scanChannelHistory(channel as never, remainingIds, {
    countReactionsAsActivity: true,
    lastActivityByMemberId: lastActivityByMemberId as never,
  });

  assert.equal(reactionFetchCount, 1);
  assert.equal(remainingIds.size, 0);
  assert.equal(lastActivityByMemberId.get("member-reactive"), "reaction");
});

test("scanChannelHistory stops at maxMessagesPerChannel", async () => {
  const remainingIds = new Set(["member-one", "member-two"]);
  const lastActivityByMemberId = new Map<string, string>();
  const channel = createTextChannel([
    {
      id: "message-1",
      author: { bot: false, id: "member-one" },
      createdTimestamp: 100,
    },
    {
      id: "message-2",
      author: { bot: false, id: "member-two" },
      createdTimestamp: 200,
    },
  ]);

  const result = await scanChannelHistory(channel as never, remainingIds, {
    lastActivityByMemberId: lastActivityByMemberId as never,
    maxMessagesPerChannel: 1,
  });

  assert.equal(result.totalMessages, 1);
  assert.equal(remainingIds.has("member-one"), false);
  assert.equal(remainingIds.has("member-two"), true);
});

type FakeMessage = {
  id: string;
  author: { bot: boolean; id: string };
  createdTimestamp: number;
  reactions?: {
    cache: Map<
      string,
      {
        count?: number;
        users: {
          cache: Map<string, { id: string; bot: boolean }>;
          fetch: () => Promise<Map<string, { id: string; bot: boolean }>>;
        };
      }
    >;
  };
};

const createTextChannel = (messages: FakeMessage[]) => ({
  messages: {
    fetch: async ({ before }: { limit: number; before?: string }) => {
      if (before) {
        return {
          size: 0,
          values: () => [][Symbol.iterator](),
        };
      }

      return {
        get size() {
          return messages.length;
        },
        values: () => messages.values(),
      };
    },
  },
});
