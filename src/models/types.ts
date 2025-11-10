import type { GuildMember } from "discord.js";

export type ScanProgressCallbacks = {
  onChannelStart?(channelName: string, index: number, total: number): void;
  onChannelComplete?(channelName: string, index: number, total: number): void;
  onMemberProgress?(processedMembers: number, totalMembers: number): void;
};

export type ScanZeroMessagesOptions = {
  guildId: string;
  targetChannelNames: string[];
  dryRun?: boolean;
  isCancelled?: () => boolean;
  progressCallbacks?: ScanProgressCallbacks;
};

export type ScanZeroMessagesResult = {
  guildName: string;
  totalMembersChecked: number;
  totalMessagesScanned: number;
  zeroMessageUsers: GuildMember[];
  skippedChannels: string[];
  processedChannels: string[];
  csvPath: string;
  previewNames: string[];
  moreCount: number;
  skippedPreview: string;
};

export type StartServerOptions = {
  port: number;
  guildId: string;
};

export type ScanStatus = {
  inProgress: boolean;
  currentChannel: string | null;
  currentIndex: number;
  totalChannels: number;
  processedChannels: number;
  processedMembers: number;
  totalMembers: number;
  startedAt: string | null;
  finishedAt: string | null;
  lastMessage: string | null;
  errorMessage: string | null;
};

export type ScanInactiveMembersOptions = {
  guildId: string;
  days: number;
  excludedCategories?: string[];
  progressCallbacks?: ScanProgressCallbacks;
  isCancelled?: () => boolean;
};

export type ScanInactiveMembersResult = {
  guildName: string;
  cutoffIso: string;
  totalMembersChecked: number;
  totalMessagesScanned: number;
  inactiveMembers: GuildMember[];
  skippedChannels: string[];
  processedChannels: string[];
  csvPath: string;
  previewNames: string[];
  moreCount: number;
  skippedPreview: string;
};

export type CsvFileMetadata = {
  filename: string;
  size: number;
  modifiedAt: string;
  rowCount: number;
};

export type KickFromCsvFileResult = {
  filename: string;
  dryRun: boolean;
  totalRows: number;
  matchedUsers: number;
  attemptedKicks: number;
  successfulKicks: number;
  failures: string[];
};

export type KickFromCsvRequest = {
  filenames: string[];
  dryRun?: boolean;
};

export type KickFromCsvResponse = {
  message: string;
  results: KickFromCsvFileResult[];
};

export type InactiveScanStatus = {
  inProgress: boolean;
  currentChannel: string | null;
  currentIndex: number;
  totalChannels: number;
  processedChannels: number;
  totalMessages: number;
  startedAt: string | null;
  finishedAt: string | null;
  lastMessage: string | null;
  errorMessage: string | null;
};
export type CsvFileListResponse = {
  files: CsvFileMetadata[];
};
