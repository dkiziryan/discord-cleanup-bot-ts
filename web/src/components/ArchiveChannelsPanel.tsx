import { useMemo, useState } from "react";

import type {
  ArchivedChannelSummary,
  ArchiveChannelsResponse,
} from "../models/types";
import { requestArchiveChannels } from "../services/archiveChannels";

type SelectionMap = Record<string, boolean>;

type ChannelAction = "archive" | "delete";

export const ArchiveChannelsPanel = () => {
  const [days, setDays] = useState(90);
  const [daysInput, setDaysInput] = useState("90");
  const [preview, setPreview] = useState<ArchivedChannelSummary[]>([]);
  const [selection, setSelection] = useState<SelectionMap>({});
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingAction, setProcessingAction] =
    useState<ChannelAction | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ArchiveChannelsResponse | null>(null);

  const selectedIds = useMemo(
    () =>
      preview
        .filter((channel) => selection[channel.id])
        .map((channel) => channel.id),
    [preview, selection]
  );

  const lastActionSummary = useMemo(() => {
    if (!result || result.data.processedCount === 0) {
      return null;
    }
    const verb = result.data.action === "archive" ? "Archived" : "Deleted";
    return `${verb} ${result.data.processedCount} channel(s).`;
  }, [result]);

  const handlePreview = async () => {
    if (loading) {
      return;
    }

    setLoading(true);
    setStatusMessage(null);
    setErrorMessage(null);
    setResult(null);

    try {
      const response = await requestArchiveChannels({ days, dryRun: true });
      setPreview(response.data.inactiveChannels);
      const defaultSelection: SelectionMap = {};
      response.data.inactiveChannels.forEach((channel) => {
        defaultSelection[channel.id] = true;
      });
      setSelection(defaultSelection);
      setStatusMessage(response.message);
    } catch (error) {
      setErrorMessage((error as Error).message);
      setPreview([]);
      setSelection({});
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = (channelId: string) => {
    setSelection((prev) => ({
      ...prev,
      [channelId]: !prev[channelId],
    }));
  };

  const handleSelectAll = (value: boolean) => {
    const next: SelectionMap = {};
    preview.forEach((channel) => {
      next[channel.id] = value;
    });
    setSelection(next);
  };

  const handleProcess = async (action: ChannelAction) => {
    if (processing || selectedIds.length === 0) {
      setErrorMessage("Select at least one channel to process.");
      return;
    }

    setProcessing(true);
    setProcessingAction(action);
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      const response = await requestArchiveChannels({
        days,
        channelIds: selectedIds,
        dryRun: false,
        action,
      });
      setResult(response);
      setStatusMessage(response.message);
      setPreview([]);
      setSelection({});
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setProcessing(false);
      setProcessingAction(null);
    }
  };

  return (
    <section className="archive-panel">
      <header className="archive-panel__header">
        <div>
          <h2>Archive inactive channels</h2>
          <p>
            Find channels without recent messages and move or delete them in
            bulk.
          </p>
        </div>
        <div className="archive-panel__controls">
          <label>
            Inactive for (days)
            <input
              type="number"
              min={1}
              value={daysInput}
              onChange={(event) => {
                const { value } = event.target;
                if (value === "") {
                  setDaysInput("");
                  return;
                }
                const parsed = Number(value);
                if (!Number.isNaN(parsed)) {
                  setDaysInput(value);
                  setDays(parsed);
                }
              }}
              onBlur={() => {
                if (daysInput === "") {
                  setDays(1);
                  setDaysInput("1");
                } else {
                  const parsed = Number(daysInput);
                  const clamped = Number.isNaN(parsed) ? 1 : Math.max(1, parsed);
                  setDays(clamped);
                  setDaysInput(String(clamped));
                }
              }}
              disabled={loading || processing}
            />
          </label>
          <button
            type="button"
            className="primary-button"
            onClick={handlePreview}
            disabled={loading || processing}
          >
            {loading ? "Scanning…" : "Preview inactive channels"}
          </button>
        </div>
      </header>

      {preview.length > 0 && (
        <div className="archive-panel__preview">
          <div className="archive-panel__bulk-actions">
            <span>{preview.length} channel(s) found</span>
            <div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleSelectAll(true)}
              >
                Select all
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleSelectAll(false)}
              >
                Clear all
              </button>
            </div>
          </div>
          <ul>
            {preview.map((channel) => (
              <li key={channel.id} className="archive-channel-row">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(selection[channel.id])}
                    onChange={() => handleToggle(channel.id)}
                    disabled={processing}
                  />
                  <span>
                    <strong>#{channel.name}</strong>
                    <small>
                      Last message:{" "}
                      {channel.lastMessageAt
                        ? new Date(channel.lastMessageAt).toLocaleString()
                        : "Unknown"}
                    </small>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <div className="archive-panel__actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => handleProcess("archive")}
              disabled={processing || selectedIds.length === 0}
            >
              {processing && processingAction === "archive"
                ? "Archiving…"
                : `Archive ${selectedIds.length} selected`}
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={() => handleProcess("delete")}
              disabled={processing || selectedIds.length === 0}
            >
              {processing && processingAction === "delete"
                ? "Deleting…"
                : `Delete ${selectedIds.length} selected`}
            </button>
          </div>
        </div>
      )}

      {lastActionSummary && (
        <p className="archive-panel__summary">{lastActionSummary}</p>
      )}

      <div className="feedback">
        {statusMessage && <p className="status success">{statusMessage}</p>}
        {errorMessage && <p className="status error">{errorMessage}</p>}
      </div>
    </section>
  );
};
