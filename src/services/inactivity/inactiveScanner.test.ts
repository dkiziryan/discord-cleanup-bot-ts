import test from "node:test";
import assert from "node:assert/strict";
import { scanInactiveMembers } from "./inactiveScanner";

type FakeMember = {
  id: string;
  user: { bot: boolean; tag: string };
  displayName: string;
  joinedTimestamp: number;
};

type FakeMessage = {
  id: string;
  createdTimestamp: number;
  author: { bot: boolean; id: string };
  reactions?: {
    cache: Map<
      string,
      {
        users: {
          fetch: () => Promise<Map<string, { id: string; bot: boolean }>>;
        };
      }
    >;
  };
};

const createCollection = <T extends { id: string }>(items: T[]) => {
  const map = new Map(items.map((item) => [item.id, item]));

  return {
    get size() {
      return map.size;
    },
    get(id: string) {
      return map.get(id);
    },
    keys() {
      return map.keys();
    },
    values() {
      return map.values();
    },
    filter(predicate: (value: T) => boolean) {
      return createCollection(Array.from(map.values()).filter(predicate));
    },
  };
};

const createMessageBatch = (messages: FakeMessage[]) => {
  return {
    get size() {
      return messages.length;
    },
    values: () => messages.values(),
  };
};

const createTextChannel = (options: {
  id: string;
  name: string;
  messages: FakeMessage[];
}) => {
  return {
    id: options.id,
    name: options.name,
    type: 0,
    parent: null,
    isTextBased: () => true,
    permissionsFor: () => ({
      has: () => true,
    }),
    messages: {
      fetch: async ({ before }: { limit: number; before?: string }) => {
        if (before) {
          return createMessageBatch([]);
        }
        return createMessageBatch(options.messages);
      },
    },
  };
};

const createGuild = (options: {
  members: FakeMember[];
  channels: ReturnType<typeof createTextChannel>[];
}) => {
  const me = {
    permissions: { has: () => true },
  };

  return {
    name: "Test Guild",
    members: {
      me,
      cache: createCollection(options.members),
      fetch: async (_id?: string) => {
        if (_id) {
          return me;
        }
        return options.members;
      },
    },
    channels: {
      cache: {
        values: () => options.channels.values(),
      },
      fetch: async () => undefined,
      fetchActiveThreads: async () => ({ threads: new Map() }),
    },
    client: {
      user: { id: "bot-user" },
    },
  };
};

const createClient = (guild: ReturnType<typeof createGuild>) => {
  return {
    guilds: {
      fetch: async () => guild,
    },
  };
};

test("scanInactiveMembers reports total eligible members checked, not remaining inactive members", async () => {
  const now = Date.now();
  const oldJoin = now - 120 * 24 * 60 * 60 * 1000;
  const cutoffRecentMessage = now - 5 * 24 * 60 * 60 * 1000;

  const guild = createGuild({
    members: [
      {
        id: "member-active",
        user: { bot: false, tag: "active#1234" },
        displayName: "Active User",
        joinedTimestamp: oldJoin,
      },
      {
        id: "member-inactive",
        user: { bot: false, tag: "inactive#1234" },
        displayName: "Inactive User",
        joinedTimestamp: oldJoin,
      },
    ],
    channels: [
      createTextChannel({
        id: "channel-1",
        name: "general",
        messages: [
          {
            id: "message-1",
            createdTimestamp: cutoffRecentMessage,
            author: { bot: false, id: "member-active" },
          },
        ],
      }),
    ],
  });

  const client = createClient(guild);

  const result = await scanInactiveMembers(client as never, {
    guildId: "123",
    discordUserId: "456",
    days: 30,
  });

  assert.equal(result.totalMembersChecked, 2);
  assert.equal(result.inactiveMembers.length, 1);
  assert.equal(result.inactiveMembers[0]?.id, "member-inactive");
});

test("scanInactiveMembers can count reactions as activity", async () => {
  const now = Date.now();
  const oldJoin = now - 120 * 24 * 60 * 60 * 1000;
  const cutoffRecentMessage = now - 5 * 24 * 60 * 60 * 1000;

  const reaction = {
    users: {
      fetch: async () =>
        new Map([["member-reactive", { id: "member-reactive", bot: false }]]),
    },
  };

  const guild = createGuild({
    members: [
      {
        id: "member-reactive",
        user: { bot: false, tag: "reactive#1234" },
        displayName: "Reactive User",
        joinedTimestamp: oldJoin,
      },
      {
        id: "member-inactive",
        user: { bot: false, tag: "inactive#1234" },
        displayName: "Inactive User",
        joinedTimestamp: oldJoin,
      },
    ],
    channels: [
      createTextChannel({
        id: "channel-1",
        name: "general",
        messages: [
          {
            id: "message-1",
            createdTimestamp: cutoffRecentMessage,
            author: { bot: true, id: "bot-user" },
            reactions: {
              cache: new Map([["reaction-1", reaction]]),
            },
          },
        ],
      }),
    ],
  });

  const client = createClient(guild);

  const result = await scanInactiveMembers(client as never, {
    guildId: "123",
    discordUserId: "456",
    days: 30,
    countReactionsAsActivity: true,
  });

  assert.equal(result.inactiveMembers.length, 1);
  assert.equal(result.inactiveMembers[0]?.id, "member-inactive");
  assert.equal(result.lastActivityByMemberId.get("member-reactive"), "reaction");
});
