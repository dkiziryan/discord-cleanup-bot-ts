import type { GuildMember } from "discord.js";

export type ScanProgressCallbacks = {
  onChannelStart?(channelName: string, index: number, total: number): void;
  onChannelComplete?(channelName: string, index: number, total: number): void;
  onMemberProgress?(processedMembers: number, totalMembers: number): void;
};

export type ScanZeroMessagesOptions = {
  guildId: string;
  discordUserId: string;
  targetChannelNames: string[];
  dryRun?: boolean;
  countReactionsAsActivity?: boolean;
  ignoredUserIds?: Set<string>;
  isCancelled?: () => boolean;
  progressCallbacks?: ScanProgressCallbacks;
};

export type ScanZeroMessagesResult = {
  guildName: string;
  totalMembersChecked: number;
  totalMessagesScanned: number;
  zeroMessageUsers: GuildMember[];
  lastActivityByMemberId: Map<string, LastActivityType>;
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
  result: ScanZeroMessagesResponse | null;
};

export type ScanZeroMessagesResponse = {
  message: string;
  channels: string[];
  data: {
    guildName: string;
    csvPath: string;
    zeroMessageCount: number;
    totalMembersChecked: number;
    totalMessagesScanned: number;
    skippedChannels: string[];
    processedChannels: string[];
    previewNames: string[];
    moreCount: number;
    skippedPreview: string;
  };
};

export type ScanInactiveMembersOptions = {
  guildId: string;
  discordUserId: string;
  days: number;
  excludedCategories?: string[];
  countReactionsAsActivity?: boolean;
  ignoredUserIds?: Set<string>;
  progressCallbacks?: ScanProgressCallbacks;
  isCancelled?: () => boolean;
};

export type LastActivityType = "none" | "message" | "reaction";

export type ScanInactiveMembersResult = {
  guildName: string;
  cutoffIso: string;
  totalMembersChecked: number;
  totalMessagesScanned: number;
  inactiveMembers: GuildMember[];
  lastActivityByMemberId: Map<string, LastActivityType>;
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

export type CleanupRolesOptions = {
  guildId: string;
  dryRun?: boolean;
};

export type CleanupRolesResult = {
  guildName: string;
  totalRoles: number;
  deletableRoleCount: number;
  deletedRoleCount: number;
  previewNames: string[];
  moreCount: number;
  failures: string[];
};

export type ArchiveChannelsOptions = {
  guildId: string;
  days: number;
  channelIds?: string[];
  dryRun?: boolean;
  action?: "archive" | "delete";
  excludedCategories?: string[];
};

export type ArchivedChannelSummary = {
  id: string;
  name: string;
  lastMessageAt: string | null;
};

export type ArchiveChannelsResult = {
  inactiveChannels: ArchivedChannelSummary[];
  processedCount: number;
  archiveCategoryId: string | null;
  action: "archive" | "delete";
  failures: string[];
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

export type JobHistoryItem = {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  guildId: string | null;
  summary: string;
  errorMessage: string | null;
};

export type JobHistoryResponse = {
  jobs: JobHistoryItem[];
};

export type IgnoredUser = {
  id: string;
  discordUserId: string;
  username: string | null;
  createdAt: string;
};

export type IgnoredUsersResponse = {
  users: IgnoredUser[];
  count: number;
};

export type ImportIgnoredUsersResponse = {
  message: string;
  addedCount: number;
  skippedCount: number;
  totalCount: number;
};
