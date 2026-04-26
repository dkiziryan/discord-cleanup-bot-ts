import path from "node:path";

import type { Job, JobStatus, JobType, Prisma } from "@prisma/client";

import { getPrismaClient } from "../../utils/prismaClient";
import type { JobHistoryItem } from "../../models/types";

type CreateRunningJobOptions = {
  discordUserId: string;
  inputJson?: Prisma.InputJsonValue;
  type: JobType;
};

type CompleteJobOptions = {
  resultJson?: Prisma.InputJsonValue;
};

type FailJobOptions = {
  errorMessage: string;
  status: Extract<JobStatus, "cancelled" | "failed">;
};

type RegisterCsvArtifactOptions = {
  csvPath: string;
  jobId: string;
};

export const createRunningJob = async ({
  discordUserId,
  inputJson,
  type,
}: CreateRunningJobOptions): Promise<string> => {
  const prisma = await getPrismaClient();
  const user = await prisma.user.findUnique({
    where: { discordUserId },
    select: { id: true },
  });

  if (!user) {
    throw new Error("Authenticated user record was not found.");
  }

  const job = await prisma.job.create({
    data: {
      createdByUserId: user.id,
      inputJson,
      startedAt: new Date(),
      status: "running",
      type,
    },
    select: { id: true },
  });

  return job.id;
};

export const completeJob = async (
  jobId: string,
  options: CompleteJobOptions = {},
): Promise<void> => {
  await updateJobStatus(jobId, {
    finishedAt: new Date(),
    resultJson: options.resultJson,
    status: "completed",
  });
};

export const failJob = async (
  jobId: string,
  options: FailJobOptions,
): Promise<void> => {
  await updateJobStatus(jobId, {
    errorMessage: options.errorMessage,
    finishedAt: new Date(),
    status: options.status,
  });
};

export const registerCsvArtifact = async ({
  csvPath,
  jobId,
}: RegisterCsvArtifactOptions): Promise<void> => {
  const prisma = await getPrismaClient();
  await prisma.artifact.create({
    data: {
      filename: path.basename(csvPath),
      jobId,
      kind: "csv",
      storagePath: csvPath,
    },
  });
};

export const listJobHistory = async (
  discordUserId: string,
  guildId: string,
  limit = 20,
): Promise<JobHistoryItem[]> => {
  const prisma = await getPrismaClient();
  const user = await prisma.user.findUnique({
    where: { discordUserId },
    select: { id: true },
  });

  if (!user) {
    return [];
  }

  const jobs = await prisma.job.findMany({
    where: { createdByUserId: user.id },
    orderBy: { createdAt: "desc" },
    take: Math.max(limit * 10, 100),
  });

  return jobs
    .map((job: Job) => {
      const jobGuildId = readJsonString(job.inputJson, "guildId");
      return {
        id: job.id,
        type: job.type,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
        guildId: jobGuildId,
        summary: buildJobSummary(job.type, job.resultJson),
        errorMessage: job.errorMessage,
      };
    })
    .filter((job: JobHistoryItem) => job.guildId === guildId)
    .slice(0, limit);
};

const buildJobSummary = (
  type: JobType,
  resultJson: Prisma.JsonValue | null,
): string => {
  const message = readJsonString(resultJson, "message");
  if (message) {
    return message;
  }

  switch (type) {
    case "zero_scan":
      return "Zero-message scan";
    case "inactive_scan":
      return "Inactive-member scan";
    case "kick_csv":
      return "Kick from CSV";
    case "cleanup_roles":
      return "Remove empty roles";
    case "archive_channels":
      return "Archive inactive channels";
    default:
      return "Dashboard action";
  }
};

const readJsonString = (
  value: Prisma.JsonValue | null,
  key: string,
): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const maybeValue = value[key];
  return typeof maybeValue === "string" ? maybeValue : null;
};

const updateJobStatus = async (
  jobId: string,
  data: Prisma.JobUpdateInput,
): Promise<void> => {
  const prisma = await getPrismaClient();
  await prisma.job.update({
    where: { id: jobId },
    data,
  });
};
