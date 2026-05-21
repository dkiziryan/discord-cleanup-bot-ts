import type { Application, Request, Response } from "express";

import type {
  CsvFileListResponse,
  CsvRowsResponse,
} from "../models/types";
import { listCsvFiles } from "../services/csv/csvManager";
import { buildCsvRowsPage } from "../services/csv/csvRows";
import { readScopedCsvFile } from "../services/csv/csvStorage";

type CsvRouteDependencies = {
  requireAuthenticatedDiscordUserId: (
    req: Request,
    res: Response,
  ) => string | null;
  requireSelectedGuildId: (req: Request, res: Response) => string | null;
};

export const registerCsvRoutes = (
  app: Application,
  {
    requireAuthenticatedDiscordUserId,
    requireSelectedGuildId,
  }: CsvRouteDependencies,
): void => {
  app.get("/api/csv-files", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    const discordUserId = requireAuthenticatedDiscordUserId(req, res);
    if (!discordUserId) {
      return;
    }

    try {
      const files = await listCsvFiles({
        guildId: activeGuildId,
        discordUserId,
      });
      const payload: CsvFileListResponse = { files };
      res.json(payload);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.get("/api/csv-files/:filename/download", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    const discordUserId = requireAuthenticatedDiscordUserId(req, res);
    if (!discordUserId) {
      return;
    }

    try {
      const csvFile = await readScopedCsvFile(req.params.filename, {
        guildId: activeGuildId,
        discordUserId,
      });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${csvFile.filename.replace(/"/g, "")}"`,
      );
      res.setHeader("Content-Length", String(csvFile.size));
      res.send(csvFile.contents);
    } catch (error) {
      const message = (error as Error).message;
      const status = message.includes("not found") ? 404 : 400;
      res.status(status).json({ message });
    }
  });

  app.get("/api/csv-files/:filename/rows", async (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    const discordUserId = requireAuthenticatedDiscordUserId(req, res);
    if (!discordUserId) {
      return;
    }

    try {
      const csvFile = await readScopedCsvFile(req.params.filename, {
        guildId: activeGuildId,
        discordUserId,
      });
      const payload: CsvRowsResponse = buildCsvRowsPage(
        csvFile.filename,
        csvFile.contents,
        {
          page: req.query.page,
          pageSize: req.query.pageSize,
          search: req.query.search,
        },
      );
      res.json(payload);
    } catch (error) {
      const message = (error as Error).message;
      const status = message.includes("not found") ? 404 : 400;
      res.status(status).json({ message });
    }
  });
};
