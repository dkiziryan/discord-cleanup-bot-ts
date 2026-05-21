// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CsvExportsPanel } from "./CsvExportsPanel";
import { fetchCsvFiles, fetchCsvRows } from "../../services/csv/csvFiles";
import type { CsvRowsResponse } from "../../models/types";

vi.mock("../../services/csv/csvFiles", () => ({
  buildCsvDownloadUrl: (filename: string) =>
    `/api/csv-files/${encodeURIComponent(filename)}/download`,
  fetchCsvFiles: vi.fn(),
  fetchCsvRows: vi.fn(),
}));

const csvRows = (search: string, username: string): CsvRowsResponse => ({
  filename: "inactive-users.csv",
  columns: ["Username"],
  rows: [{ Username: username }],
  page: 1,
  pageSize: 25,
  totalRows: 1,
  totalPages: 1,
  search,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CsvExportsPanel", () => {
  it("loads CSV rows and refreshes the viewer after search input changes", async () => {
    vi.mocked(fetchCsvFiles).mockResolvedValue([
      {
        filename: "inactive-users.csv",
        modifiedAt: "2026-05-21T12:00:00.000Z",
        size: 128,
      },
    ]);
    vi.mocked(fetchCsvRows).mockImplementation(async ({ search }) =>
      search ? csvRows(search, "Boris") : csvRows("", "Alice"),
    );

    render(<CsvExportsPanel />);

    expect(await screen.findByText("Alice")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search by name"), {
      target: { value: "bor" },
    });

    expect(await screen.findByText("Boris")).toBeTruthy();
    await waitFor(() => {
      expect(fetchCsvRows).toHaveBeenLastCalledWith({
        filename: "inactive-users.csv",
        page: 1,
        pageSize: 25,
        search: "bor",
      });
    });
  });

  it("shows row load errors for the selected export", async () => {
    vi.mocked(fetchCsvFiles).mockResolvedValue([
      {
        filename: "inactive-users.csv",
        modifiedAt: "2026-05-21T12:00:00.000Z",
        size: 128,
      },
    ]);
    vi.mocked(fetchCsvRows).mockRejectedValue(new Error("Rows unavailable."));

    render(<CsvExportsPanel />);

    expect(await screen.findByText("Rows unavailable.")).toBeTruthy();
  });
});
