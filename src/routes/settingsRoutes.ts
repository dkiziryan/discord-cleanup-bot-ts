import type { Application, Request, Response } from "express";

import type { IgnoredUsersResponse } from "../models/types";
import {
  addIgnoredUser,
  buildIgnoredUsersCsv,
  importIgnoredUsers,
  listIgnoredUsers,
  mapIgnoredUserRecord,
  removeIgnoredUser,
} from "../services/ignoredUsers/ignoredUsers";
import {
  getLocalDevIgnoredUserSource,
  setLocalDevIgnoredUserSource,
} from "../services/ignoredUsers/ignoredUserSource";

type SettingsRouteDependencies = {
  requireSelectedGuildId: (req: Request, res: Response) => string | null;
};

export const registerSettingsRoutes = (
  app: Application,
  { requireSelectedGuildId }: SettingsRouteDependencies,
): void => {
  app.get("/api/local-dev-settings", (_req, res) => {
    res.json(getLocalDevIgnoredUserSource());
  });

  app.post("/api/local-dev-settings", (req, res) => {
    const settings = setLocalDevIgnoredUserSource(
      Boolean(req.body?.useProductionData),
    );
    res.json(settings);
  });

  app.get("/api/ignored-users", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    try {
      const users = await listIgnoredUsers(activeGuildId);
      const payload: IgnoredUsersResponse = {
        users: users.map(mapIgnoredUserRecord),
        count: users.length,
      };
      res.json(payload);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/ignored-users", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    try {
      const discordUserId =
        typeof req.body?.discordUserId === "string"
          ? req.body.discordUserId
          : "";
      const username =
        typeof req.body?.username === "string" ? req.body.username : null;
      const user = await addIgnoredUser(activeGuildId, discordUserId, username);
      res.status(201).json({ user: mapIgnoredUserRecord(user) });
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.post("/api/ignored-users/import", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    try {
      const result = await importIgnoredUsers(activeGuildId, {
        csvText:
          typeof req.body?.csvText === "string" ? req.body.csvText : undefined,
        discordUserIds: Array.isArray(req.body?.discordUserIds)
          ? req.body.discordUserIds
          : undefined,
      });
      res.json({
        ...result,
        message: `Imported ${result.addedCount} ignored user(s).`,
      });
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.delete("/api/ignored-users/:discordUserId", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    try {
      const removed = await removeIgnoredUser(
        activeGuildId,
        req.params.discordUserId,
      );
      if (!removed) {
        res.status(404).json({ message: "Ignored user not found." });
        return;
      }

      res.json({ message: "Ignored user removed." });
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.get("/api/ignored-users/export", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    try {
      const users = await listIgnoredUsers(activeGuildId);
      const contents = buildIgnoredUsersCsv(users);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ignored-users-${activeGuildId}.csv"`,
      );
      res.send(contents);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });
};
