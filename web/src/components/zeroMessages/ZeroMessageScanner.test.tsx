// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ZeroMessageScanner } from "./ZeroMessageScanner";
import { fetchDefaultChannels } from "../../services/zeroMessages/defaultChannels";
import { fetchScanStatus } from "../../services/zeroMessages/scanStatus";
import { requestZeroMessageScan } from "../../services/zeroMessages/zeroMessages";
import type { ScanResponse, ScanStatus } from "../../models/types";

vi.mock("../../services/zeroMessages/defaultChannels", () => ({
  fetchDefaultChannels: vi.fn(),
}));
vi.mock("../../services/zeroMessages/scanStatus", () => ({
  fetchScanStatus: vi.fn(),
}));
vi.mock("../../services/zeroMessages/zeroMessages", () => ({
  requestZeroMessageScan: vi.fn(),
}));
vi.mock("../../services/zeroMessages/cancelScan", () => ({
  cancelScan: vi.fn(),
}));

const result: ScanResponse = {
  message: "Zero-message scan complete.",
  channels: ["general"],
  data: {
    guildName: "Test Guild",
    csvPath: "zero-message-users.csv",
    zeroMessageCount: 1,
    totalMembersChecked: 12,
    totalMessagesScanned: 42,
    skippedChannels: [],
    processedChannels: ["general"],
    previewNames: ["Alice"],
    moreCount: 0,
    skippedPreview: "",
  },
};

const completedStatus: ScanStatus = {
  inProgress: false,
  currentChannel: null,
  currentIndex: 1,
  totalChannels: 1,
  processedChannels: 1,
  processedMembers: 12,
  totalMembers: 12,
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

describe("ZeroMessageScanner", () => {
  it("submits default channels and renders polled results", async () => {
    vi.mocked(fetchDefaultChannels).mockResolvedValue(["general"]);
    vi.mocked(requestZeroMessageScan).mockResolvedValue();
    vi.mocked(fetchScanStatus).mockResolvedValue(completedStatus);

    render(<ZeroMessageScanner />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Target channel names/)).toHaveProperty(
        "value",
        "general",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Scan for zero-message users" }));

    expect(await screen.findByText("Scan results")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(requestZeroMessageScan).toHaveBeenCalledWith({
      channelNames: ["general"],
      countReactionsAsActivity: false,
      dryRun: false,
      maxMessagesPerChannel: 5000,
    });
  });
});
