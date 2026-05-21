import type { Application, RequestHandler } from "express";
import type { Client } from "discord.js";
import crypto from "node:crypto";

import {
  authenticateDiscordUser,
  buildDiscordLoginUrl,
} from "../services/auth/discordOAuth";
import {
  authorizeDiscordUser,
  listAuthorizedGuilds,
} from "../services/auth/authorization";
import { getPostLoginRedirectUrl } from "../services/auth/postLoginRedirect";
import { renderUnauthorizedPage } from "../services/auth/unauthorizedPage";

type AuthRouteDependencies = {
  client: Client;
  defaultGuildId: string;
  isProduction: boolean;
  requireAuthenticatedSession: RequestHandler;
};

export const registerAuthRoutes = (
  app: Application,
  {
    client,
    defaultGuildId,
    isProduction,
    requireAuthenticatedSession,
  }: AuthRouteDependencies,
): void => {
  app.get("/auth/discord/login", (req, res) => {
    try {
      const oauthState = crypto.randomUUID();
      req.session.oauthState = oauthState;
      const loginUrl = buildDiscordLoginUrl(oauthState);
      req.session.save((error) => {
        if (error) {
          res
            .status(500)
            .json({ message: "Failed to initialize login session." });
          return;
        }

        res.redirect(loginUrl);
      });
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.get("/auth/discord/callback", async (req, res) => {
    const code =
      typeof req.query.code === "string" ? req.query.code.trim() : "";
    const state =
      typeof req.query.state === "string" ? req.query.state.trim() : "";
    if (!code) {
      res.status(400).json({ message: "Missing Discord OAuth code." });
      return;
    }

    if (!state || !req.session.oauthState || state !== req.session.oauthState) {
      res.status(400).json({ message: "Invalid Discord OAuth state." });
      return;
    }

    delete req.session.oauthState;

    try {
      const user = await authenticateDiscordUser(code);
      const authorizedGuilds = await listAuthorizedGuilds(
        client,
        user.discordUserId,
      );
      const selectedGuild =
        authorizedGuilds.find((guild) => guild.id === defaultGuildId) ??
        authorizedGuilds[0] ??
        null;
      req.session.authUser = {
        ...user,
        isAuthorized: authorizedGuilds.length > 0,
        authorizedGuilds,
        selectedGuildId: selectedGuild?.id ?? null,
      };

      if (!req.session.authUser.isAuthorized) {
        res
          .status(403)
          .type("html")
          .send(renderUnauthorizedPage("no_admin_guilds"));
        return;
      }

      req.session.save((error) => {
        if (error) {
          res.status(500).json({ message: "Failed to persist login session." });
          return;
        }

        res.redirect(getPostLoginRedirectUrl(isProduction));
      });
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.get("/auth/me", (req, res) => {
    if (!req.session.authUser) {
      res.status(401).json({ message: "Not authenticated." });
      return;
    }

    res.json({ user: req.session.authUser });
  });

  app.post(
    "/auth/guild/select",
    requireAuthenticatedSession,
    async (req, res) => {
      const requestedGuildId =
        typeof req.body?.guildId === "string" ? req.body.guildId.trim() : "";
      const authUser = req.session.authUser;
      const authorizedGuild = authUser?.authorizedGuilds.find(
        (guild) => guild.id === requestedGuildId,
      );

      if (!authUser || !authorizedGuild) {
        res
          .status(403)
          .json({ message: "Server management permission required." });
        return;
      }

      const authorization = await authorizeDiscordUser(
        client,
        authorizedGuild.id,
        authUser.discordUserId,
      );

      if (!authorization.isAuthorized) {
        authUser.authorizedGuilds = authUser.authorizedGuilds.filter(
          (guild) => guild.id !== authorizedGuild.id,
        );
        authUser.selectedGuildId = authUser.authorizedGuilds[0]?.id ?? null;
        authUser.isAuthorized = authUser.authorizedGuilds.length > 0;
        res
          .status(403)
          .json({ message: "Server management permission required." });
        return;
      }

      authUser.selectedGuildId = authorizedGuild.id;
      req.session.save((error) => {
        if (error) {
          res
            .status(500)
            .json({ message: "Failed to persist selected guild." });
          return;
        }

        res.json({ user: authUser });
      });
    },
  );

  app.post("/auth/logout", (req, res) => {
    req.session.destroy((error) => {
      if (error) {
        res.status(500).json({ message: "Failed to clear session." });
        return;
      }

      res.clearCookie("connect.sid");
      res.json({ message: "Logged out." });
    });
  });
};
