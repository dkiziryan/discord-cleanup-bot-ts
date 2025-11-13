export type ScanResponse = {
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

export type ApiError = {
  message: string;
};

export type ZeroMessagesRequest = {
  channelNames?: string[];
  dryRun?: boolean;
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

export type ResultsPageProps = {
  result: ScanResponse;
  previewLines: string[] | null;
  statusMessage: string | null;
  onRunAnotherScan: () => void;
};

export type DefaultChannelsResponse = {
  channels: string[];
};

export type DefaultInactiveCategoriesResponse = {
  categories: string[];
};

export type CsvFileMetadata = {
  filename: string;
  size: number;
  modifiedAt: string;
  rowCount: number;
};

export type CsvFileListResponse = {
  files: CsvFileMetadata[];
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

export type KickFromCsvResponse = {
  message: string;
  results: KickFromCsvFileResult[];
};

export type InactiveScanResponse = {
  message: string;
  data: {
    guildName: string;
    csvPath: string;
    cutoffIso: string;
    inactiveCount: number;
    totalMembersChecked: number;
    totalMessagesScanned: number;
    skippedChannels: string[];
    processedChannels: string[];
    previewNames: string[];
    moreCount: number;
    skippedPreview: string;
  };
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

export type CleanupRolesRequest = {
  dryRun?: boolean;
};

export type CleanupRolesResponse = {
  message: string;
  data: {
    guildName: string;
    totalRoles: number;
    deletableRoleCount: number;
    deletedRoleCount: number;
    previewNames: string[];
    moreCount: number;
    failures: string[];
  };
};

export type ArchivedChannelSummary = {
  id: string;
  name: string;
  lastMessageAt: string | null;
};

export type ArchiveChannelsRequest = {
  days: number;
  channelIds?: string[];
  dryRun?: boolean;
  action?: "archive" | "delete";
};

export type ArchiveChannelsResponse = {
  message: string;
  data: {
    days: number;
    inactiveChannels: ArchivedChannelSummary[];
    processedCount: number;
    archiveCategoryId: string | null;
    action: "archive" | "delete";
    failures: string[];
  };
};
