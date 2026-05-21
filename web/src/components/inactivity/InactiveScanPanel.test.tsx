// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InactiveScanPanel } from "./InactiveScanPanel";
import { fetchDefaultInactiveCategories } from "../../services/inactivity/inactiveDefaults";
import { fetchInactiveStatus } from "../../services/inactivity/inactiveStatus";
import { requestInactiveScan } from "../../services/inactivity/inactiveScan";
import type { InactiveScanResponse, InactiveScanStatus } from "../../models/types";

vi.mock("../../services/inactivity/inactiveDefaults", () => ({
  fetchDefaultInactiveCategories: vi.fn(),
}));
vi.mock("../../services/inactivity/inactiveStatus", () => ({
  fetchInactiveStatus: vi.fn(),
}));
vi.mock("../../services/inactivity/inactiveScan", () => ({
  requestInactiveScan: vi.fn(),
}));
vi.mock("../../services/inactivity/cancelInactiveScan", () => ({
  cancelInactiveScan: vi.fn(),
}));

const result: InactiveScanResponse = {
  message: "Inactive scan complete.",
  data: {
    guildName: "Test Guild",
    csvPath: "inactive-users.csv",
    cutoffIso: "2025-11-22T12:00:00.000Z",
    inactiveCount: 1,
    totalMembersChecked: 12,
    totalMessagesScanned: 42,
    skippedChannels: [],
    processedChannels: ["general"],
    previewNames: ["Alice"],
    moreCount: 0,
    skippedPreview: "",
  },
};

const completedStatus: InactiveScanStatus = {
  inProgress: false,
  currentChannel: null,
  currentIndex: 1,
  totalChannels: 1,
  processedChannels: 1,
  totalMessages: 42,
  startedAt: "2026-05-21T12:00:00.000Z",
  finishedAt: "2026-05-21T12:00:01.000Z",
  lastMessage: result.message,
  errorMessage: null,
  result,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InactiveScanPanel", () => {
  it("submits the fast scan request and renders polled results", async () => {
    vi.mocked(fetchDefaultInactiveCategories).mockResolvedValue(["announcements"]);
    vi.mocked(requestInactiveScan).mockResolvedValue();
    vi.mocked(fetchInactiveStatus).mockResolvedValue(completedStatus);

    render(<InactiveScanPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Scan inactive members" }));

    expect(await screen.findByText("Alice")).toBeTruthy();
    expect(requestInactiveScan).toHaveBeenCalledWith({
      days: 180,
      excludedCategories: undefined,
      countReactionsAsActivity: false,
      maxMessagesPerChannel: 5000,
    });
  });
});
