import { Client, Events, GatewayIntentBits, Message } from "discord.js";
import dotenv from "dotenv";

import { startHttpServer } from "./server";
import { cleanupEmptyRoles } from "./services/roleCleanup";

dotenv.config();

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const httpPort = Number.parseInt(process.env.HTTP_PORT ?? "3001", 10);

if (!token) {
  throw new Error("Missing DISCORD_TOKEN environment variable. Check your .env file.");
}

if (!guildId) {
  throw new Error("Missing DISCORD_GUILD_ID environment variable. Add it to your .env file.");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[${new Date().toISOString()}] Logged in as ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, (message) => {
  if (message.author.bot) {
    return;
  }

  const content = message.content.trim().toLowerCase();

  if (content === "?testing") {
    console.log(`works ${new Date().toISOString()}`);
  }

  if (content === "?cleanuproles") {
    void handleCleanupRolesCommand(message);
  }
});

startHttpServer(client, { port: httpPort, guildId });

void client.login(token);

const ROLE_CLEANUP_CONFIRMATION_TIMEOUT_MS = 30_000;

async function handleCleanupRolesCommand(message: Message) {
  if (!message.inGuild()) {
    await message.reply("This command can only be used inside a server.");
    return;
  }

  if (message.guildId !== guildId) {
    await message.reply("This command is disabled for this server.");
    return;
  }

  try {
    const preview = await cleanupEmptyRoles(client, { guildId, dryRun: true });

    if (preview.deletableRoleCount === 0) {
      await message.reply("No empty roles were found to clean up.");
      return;
    }

    const previewList = preview.previewNames.length > 0
      ? `${preview.previewNames.join(", ")}${preview.moreCount > 0 ? ` ...and ${preview.moreCount} more` : ""}`
      : "(role names unavailable)";

    await message.reply(
      `Found ${preview.deletableRoleCount} empty role(s): ${previewList}. ` +
        `Reply with "yes" to delete them or "no" to cancel within 30 seconds.`,
    );

    const responses = await message.channel.awaitMessages({
      filter: (response) =>
        response.author.id === message.author.id &&
        ["yes", "y", "no", "n", "cancel"].includes(response.content.trim().toLowerCase()),
      max: 1,
      time: ROLE_CLEANUP_CONFIRMATION_TIMEOUT_MS,
    });

    const confirmation = responses.first();
    if (!confirmation) {
      await message.channel.send("Role cleanup timed out without confirmation.");
      return;
    }

    const normalized = confirmation.content.trim().toLowerCase();
    if (!["yes", "y"].includes(normalized)) {
      await message.channel.send("Role cleanup cancelled.");
      return;
    }

    const result = await cleanupEmptyRoles(client, { guildId, dryRun: false });
    const summary = result.deletedRoleCount > 0
      ? `Deleted ${result.deletedRoleCount} empty role(s).`
      : "No roles were deleted.";
    const failureNote = result.failures.length > 0
      ? ` Issues encountered: ${result.failures.join("; ")}`
      : "";

    await message.channel.send(`${summary}${failureNote}`);
  } catch (error) {
    await message.channel.send(`Failed to clean up roles: ${(error as Error).message}`);
  }
}
