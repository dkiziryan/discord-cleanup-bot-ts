import type { Application, Request, Response } from "express";

import type { InactiveScanStatus, ScanStatus } from "../models/types";
import type { ScanCancellationController } from "../utils/cancellationController";

type StatusRouteDependencies = {
  activeCancellationByGuild: Map<string, ScanCancellationController>;
  getInactiveStatus: (activeGuildId: string) => InactiveScanStatus;
  getScanStatus: (activeGuildId: string) => ScanStatus;
  inactiveCancellationByGuild: Map<string, ScanCancellationController>;
  isInactiveProcessingByGuild: Map<string, boolean>;
  isKickProcessingByGuild: Map<string, boolean>;
  isProcessingByGuild: Map<string, boolean>;
  kickCancellationByGuild: Map<string, ScanCancellationController>;
  requireSelectedGuildId: (req: Request, res: Response) => string | null;
  updateInactiveStatus: (
    activeGuildId: string,
    partial: Partial<InactiveScanStatus>,
  ) => void;
  updateScanStatus: (
    activeGuildId: string,
    partial: Partial<ScanStatus>,
  ) => void;
};

export const registerStatusRoutes = (
  app: Application,
  {
    activeCancellationByGuild,
    getInactiveStatus,
    getScanStatus,
    inactiveCancellationByGuild,
    isInactiveProcessingByGuild,
    isKickProcessingByGuild,
    isProcessingByGuild,
    kickCancellationByGuild,
    requireSelectedGuildId,
    updateInactiveStatus,
    updateScanStatus,
  }: StatusRouteDependencies,
): void => {
  app.get("/api/scan-status", (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    res.json({ ...getScanStatus(activeGuildId) });
  });

  app.get("/api/inactive-status", (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    res.json({ ...getInactiveStatus(activeGuildId) });
  });

  app.post("/api/cancel-scan", (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    const activeCancellation = activeCancellationByGuild.get(activeGuildId);
    if (!isProcessingByGuild.get(activeGuildId) || !activeCancellation) {
      res.status(409).json({ message: "No scan is currently running." });
      return;
    }

    activeCancellation.cancel();
    updateScanStatus(activeGuildId, {
      lastMessage: "Cancelling scan…",
      errorMessage: null,
    });
    res.json({ message: "Cancellation requested." });
  });

  app.post("/api/cancel-inactive", (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    const inactiveCancellation =
      inactiveCancellationByGuild.get(activeGuildId);
    if (
      !isInactiveProcessingByGuild.get(activeGuildId) ||
      !inactiveCancellation
    ) {
      res
        .status(409)
        .json({ message: "No inactive scan is currently running." });
      return;
    }

    inactiveCancellation.cancel();
    updateInactiveStatus(activeGuildId, {
      lastMessage: "Cancelling inactive scan…",
      errorMessage: null,
    });
    res.json({ message: "Cancellation requested." });
  });

  app.post("/api/cancel-kick", (req, res) => {
    const activeGuildId = requireSelectedGuildId(req, res);
    if (!activeGuildId) {
      return;
    }

    const kickCancellation = kickCancellationByGuild.get(activeGuildId);
    if (!isKickProcessingByGuild.get(activeGuildId) || !kickCancellation) {
      res.status(409).json({ message: "No kick job is currently running." });
      return;
    }

    kickCancellation.cancel();
    res.json({ message: "Cancellation requested." });
  });
};
