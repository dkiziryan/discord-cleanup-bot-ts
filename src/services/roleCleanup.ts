import type { APIGuildMember } from "discord-api-types/v10";
import { Routes } from "discord-api-types/v10";
import type { Client } from "discord.js";

import type { CleanupRolesOptions, CleanupRolesResult } from "../models/types";

const PREVIEW_LIMIT = 10;
const MAX_PAGES = 25_000; // Safety guard for extremely large guilds.

export async function cleanupEmptyRoles(
  client: Client,
  options: CleanupRolesOptions,
): Promise<CleanupRolesResult> {
  const { guildId, dryRun = true } = options;

  const guild = await client.guilds.fetch(guildId);
  const roleMemberCounts = await collectRoleMemberCounts(client, guildId);
  const roles = await guild.roles.fetch();

  const deletableRoles = roles.filter((role) => {
    if (role.id === guild.id) {
      return false;
    }
    if (role.managed) {
      return false;
    }
    const memberCount = roleMemberCounts.get(role.id) ?? 0;
    return memberCount === 0;
  });

  const sortedRoles = [...deletableRoles.values()].sort((a, b) => a.name.localeCompare(b.name));
  const previewNames = sortedRoles.slice(0, PREVIEW_LIMIT).map((role) => role.name);
  const moreCount = Math.max(sortedRoles.length - previewNames.length, 0);

  const failures: string[] = [];
  let deletedRoleCount = 0;

  if (!dryRun) {
    for (const role of sortedRoles) {
      try {
        await role.delete("Discord Cleanup Bot: remove empty role");
        deletedRoleCount += 1;
      } catch (error) {
        failures.push(`${role.name}: ${(error as Error).message}`);
      }
    }
  }

  return {
    guildName: guild.name,
    totalRoles: roles.size,
    deletableRoleCount: deletableRoles.size,
    deletedRoleCount,
    previewNames,
    moreCount,
    failures,
  };
}

type RawGuildMember = APIGuildMember & { user?: { id: string } };

async function collectRoleMemberCounts(client: Client, guildId: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const limit = 1000;
  let after: string | undefined;
  let page = 0;

  while (page < MAX_PAGES) {
    const query = new URLSearchParams({ limit: limit.toString() });
    if (after) {
      query.set("after", after);
    }

    const batch = (await client.rest.get(Routes.guildMembers(guildId), { query })) as RawGuildMember[];
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }

    for (const member of batch) {
      for (const roleId of member.roles) {
        counts.set(roleId, (counts.get(roleId) ?? 0) + 1);
      }
    }

    if (batch.length < limit) {
      break;
    }

    const lastMember = batch[batch.length - 1];
    const lastId = lastMember?.user?.id;
    if (!lastId || lastId === after) {
      break;
    }
    after = lastId;
    page += 1;
  }

  return counts;
}
