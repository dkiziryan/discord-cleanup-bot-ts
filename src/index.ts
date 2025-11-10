import { Client, Events, GatewayIntentBits } from "discord.js";
import dotenv from "dotenv";

import { startHttpServer } from "./server";

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

  if (message.content.trim() === "?testing") {
    console.log(`works ${new Date().toISOString()}`);
  }
});

startHttpServer(client, { port: httpPort, guildId });

void client.login(token);
