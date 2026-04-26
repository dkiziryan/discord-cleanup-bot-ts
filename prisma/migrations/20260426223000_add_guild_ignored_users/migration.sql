CREATE TABLE "GuildIgnoredUser" (
    "id" TEXT NOT NULL,
    "discordGuildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuildIgnoredUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuildIgnoredUser_discordGuildId_discordUserId_key" ON "GuildIgnoredUser"("discordGuildId", "discordUserId");

CREATE INDEX "GuildIgnoredUser_discordGuildId_idx" ON "GuildIgnoredUser"("discordGuildId");
