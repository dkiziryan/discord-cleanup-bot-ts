import { useEffect, useMemo, useState } from "react";

import styles from "./InactiveScanPanel.module.css";
import type { InactiveScanResponse, InactiveScanStatus } from "../../models/types";
import { requestInactiveScan } from "../../services/inactivity/inactiveScan";
import { cancelInactiveScan } from "../../services/inactivity/cancelInactiveScan";
import { fetchInactiveStatus } from "../../services/inactivity/inactiveStatus";
import { fetchDefaultInactiveCategories } from "../../services/inactivity/inactiveDefaults";
import { CsvDownloadButton } from "../shared/CsvDownloadButton";
import { ResultTile } from "../shared/ResultTile";
import { InactiveProgressIndicator } from "./InactiveProgressIndicator";

export const InactiveScanPanel = () => {
  const [days, setDays] = useState(180);
  const [excludedValue, setExcludedValue] = useState("");
  const [countReactionsAsActivity, setCountReactionsAsActivity] = useState(true);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<InactiveScanResponse | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [scanStatus, setScanStatus] = useState<InactiveScanStatus | null>(null);
  const [defaultCategories, setDefaultCategories] = useState<string[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const loadDefaults = async () => {
      try {
        const categories = await fetchDefaultInactiveCategories();
        if (!cancelled) {
          setDefaultCategories(categories);
        }
      } catch {
        // Silently ignore errors; UI can fall back to "no categories".
      }
    };

    void loadDefaults();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | undefined;
    let timerId: number | undefined;
    const startedAt = Date.now();

    const poll = async () => {
      const data = await fetchInactiveStatus();
      if (!cancelled) {
        setScanStatus(data);
        if (data?.result && !data.inProgress) {
          setResult(data.result);
          setStatusMessage(data.result.message);
          setErrorMessage(null);
          setLoading(false);
        } else if (data?.errorMessage && !data.inProgress) {
          setResult(null);
          setErrorMessage(data.errorMessage);
          setStatusMessage(null);
          setLoading(false);
        } else if (data?.lastMessage && !data.inProgress) {
          setStatusMessage(data.lastMessage);
          setErrorMessage(null);
          setLoading(false);
        }
      }
    };

    if (loading) {
      setElapsedSeconds(0);
      void poll();
      intervalId = window.setInterval(poll, 1500);
      timerId = window.setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);
    } else {
      setScanStatus(null);
      setCancelling(false);
    }

    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
      if (timerId !== undefined) {
        window.clearInterval(timerId);
      }
    };
  }, [loading]);

  const formattedElapsedTime = useMemo(() => {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }, [elapsedSeconds]);

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
      await requestInactiveScan({
        days,
        excludedCategories: categories.length > 0 ? categories : undefined,
        countReactionsAsActivity,
      });
    } catch (error) {
      const message = (error as Error).message;
      if (message.toLowerCase().includes("cancel")) {
        setStatusMessage(message);
        setErrorMessage(null);
      } else {
        setErrorMessage(message);
      }
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
      setCancelling(false);
    }
  };

  const preview = result?.data.previewNames ?? [];
  const moreCount = result?.data.moreCount ?? 0;

  return (
    <section className={styles.panel}>
      <header>
        <div>
          <h2>Scan for inactive members</h2>
          <p>Find members with no messages in the last N days, excluding selected categories.</p>
        </div>
      </header>

      <div className={styles.form}>
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
            Defaults always exclude {defaultCategories.length > 0
              ? defaultCategories.map((category) => `“${category}”`).join(", ")
              : "no categories"}
          </small>
        </label>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={countReactionsAsActivity}
            onChange={(event) => setCountReactionsAsActivity(event.target.checked)}
            disabled={loading}
          />
          <span>Count reactions as activity</span>
        </label>
        <div className={styles.actions}>
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
          <div className={styles.scanProgress}>
            <p className={styles.elapsedTime}>
              Elapsed scan time: {formattedElapsedTime}
            </p>
            <InactiveProgressIndicator status={scanStatus} />
          </div>
        )}
      </div>

      <div className="feedback">
        {statusMessage && <p className="status success">{statusMessage}</p>}
        {errorMessage && <p className="status error">{errorMessage}</p>}
      </div>

      {result && (
        <div className={styles.results}>
          <div className="result-grid">
            <ResultTile label="Guild" value={result.data.guildName} />
            <ResultTile label="Inactive users" value={result.data.inactiveCount} />
            <ResultTile label="Members checked" value={result.data.totalMembersChecked} />
            <ResultTile label="Messages scanned" value={result.data.totalMessagesScanned} />
            <ResultTile label="Cutoff" value={new Date(result.data.cutoffIso).toLocaleString()} />
            <ResultTile label="CSV file" value={result.data.csvPath} monospace />
          </div>
          <CsvDownloadButton filename={result.data.csvPath} />
          {result.data.skippedPreview && (
            <p className={styles.skipped}>Skipped channels: {result.data.skippedPreview}</p>
          )}
          {preview.length > 0 && (
            <div className={styles.preview}>
              <h3>Preview</h3>
              <ul>
                {preview.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
              {moreCount > 0 && <p className={styles.previewMore}>…and {moreCount} more</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
