import { useEffect, useState } from "react";

import type { InactiveScanResponse, InactiveScanStatus } from "../models/types";
import { requestInactiveScan } from "../services/inactiveScan";
import { cancelInactiveScan } from "../services/cancelInactiveScan";
import { fetchInactiveStatus } from "../services/inactiveStatus";
import { ResultTile } from "./ResultTile";
import { InactiveProgressIndicator } from "./InactiveProgressIndicator";
import { DEFAULT_INACTIVE_CATEGORIES } from "../../../src/shared/constants";

export const InactiveScanPanel = () => {
  const [days, setDays] = useState(180);
  const [excludedValue, setExcludedValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<InactiveScanResponse | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [scanStatus, setScanStatus] = useState<InactiveScanStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | undefined;

    const poll = async () => {
      const data = await fetchInactiveStatus();
      if (!cancelled) {
        setScanStatus(data);
      }
    };

    if (loading) {
      void poll();
      intervalId = window.setInterval(poll, 1500);
    } else {
      setScanStatus(null);
    }

    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [loading]);

  const handleScan = async () => {
    if (loading) {
      return;
    }

    setLoading(true);
    setStatusMessage(null);
    setErrorMessage(null);
    setResult(null);

    const categories = excludedValue
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    try {
      const response = await requestInactiveScan({
        days,
        excludedCategories: categories.length > 0 ? categories : undefined,
      });
      setResult(response);
      setStatusMessage(response.message);
    } catch (error) {
      const message = (error as Error).message;
      if (message.toLowerCase().includes("cancel")) {
        setStatusMessage(message);
        setErrorMessage(null);
      } else {
        setErrorMessage(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!loading || cancelling) {
      return;
    }

    setCancelling(true);
    try {
      await cancelInactiveScan();
      setStatusMessage("Inactive scan cancellation requested.");
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  const preview = result?.data.previewNames ?? [];
  const moreCount = result?.data.moreCount ?? 0;

  return (
    <section className="inactive-panel">
      <header className="inactive-panel__header">
        <div>
          <h2>Scan for inactive members</h2>
          <p>Find members with no messages in the last N days, excluding selected categories.</p>
        </div>
      </header>

      <div className="inactive-panel__form">
        <label>
          Days without activity
          <input
            type="number"
            min={1}
            value={days}
            onChange={(event) => setDays(Math.max(1, Number(event.target.value) || 1))}
            disabled={loading}
          />
        </label>
        <label>
          Extra categories to exclude (comma or newline separated)
          <textarea
            value={excludedValue}
            onChange={(event) => setExcludedValue(event.target.value)}
            placeholder="announcements&#10;random"
            rows={3}
            disabled={loading}
          />
          <small>
            Defaults always exclude{" "}
            {DEFAULT_INACTIVE_CATEGORIES.map((category) => `“${category}”`).join(", ")}.
          </small>
        </label>
        <div className="inactive-panel__actions">
          <button type="button" onClick={handleScan} disabled={loading} className="primary-button">
            {loading ? "Scanning…" : "Scan inactive members"}
          </button>
          {loading && (
            <button
              type="button"
              className="secondary-button secondary-button--danger"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? "Cancelling…" : "Cancel scan"}
            </button>
          )}
        </div>

        {loading && (
          <div className="scan-progress">
            <InactiveProgressIndicator status={scanStatus} />
          </div>
        )}
      </div>

      <div className="feedback">
        {statusMessage && <p className="status success">{statusMessage}</p>}
        {errorMessage && <p className="status error">{errorMessage}</p>}
      </div>

      {result && (
        <div className="inactive-results">
          <div className="result-grid">
            <ResultTile label="Guild" value={result.data.guildName} />
            <ResultTile label="Inactive users" value={result.data.inactiveCount} />
            <ResultTile label="Members checked" value={result.data.totalMembersChecked} />
            <ResultTile label="Messages scanned" value={result.data.totalMessagesScanned} />
            <ResultTile label="Cutoff" value={new Date(result.data.cutoffIso).toLocaleString()} />
            <ResultTile label="CSV file" value={result.data.csvPath} monospace />
          </div>
          {result.data.skippedPreview && (
            <p className="inactive-results__skipped">Skipped channels: {result.data.skippedPreview}</p>
          )}
          {preview.length > 0 && (
            <div className="inactive-preview">
              <h3>Preview</h3>
              <ul>
                {preview.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
              {moreCount > 0 && <p className="inactive-preview__more">…and {moreCount} more</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
