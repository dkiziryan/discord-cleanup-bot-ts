import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import styles from "./ZeroMessageScanner.module.css";
import type { ScanResponse, ScanStatus } from "../../models/types";
import { fetchDefaultChannels } from "../../services/zeroMessages/defaultChannels";
import { cancelScan } from "../../services/zeroMessages/cancelScan";
import { fetchScanStatus } from "../../services/zeroMessages/scanStatus";
import { requestZeroMessageScan } from "../../services/zeroMessages/zeroMessages";
import { parseChannelInput } from "../../utils/channel";
import { ProgressIndicator } from "../shared/ProgressIndicator";
import { ZeroScanResults } from "./ZeroScanResults";

export const ZeroMessageScanner = () => {
  const [channelInput, setChannelInput] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [countReactionsAsActivity, setCountReactionsAsActivity] = useState(false);
  const [activeView, setActiveView] = useState<"scan" | "results">("scan");
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    void loadDefaultChannels();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | undefined;
    let timerId: number | undefined;
    const startedAt = Date.now();

    const fetchStatus = async () => {
      const payload = await fetchScanStatus();
      if (!cancelled && payload) {
        setScanStatus(payload);
        if (!payload.inProgress && payload.result) {
          setResult(payload.result);
          setStatusMessage(payload.result.message);
          setErrorMessage(null);
          setActiveView("results");
          setLoading(false);
        } else if (!payload.inProgress && payload.errorMessage) {
          setResult(null);
          setStatusMessage(null);
          setErrorMessage(payload.errorMessage);
          setActiveView("scan");
          setLoading(false);
        } else if (!payload.inProgress && payload.lastMessage) {
          setStatusMessage(payload.lastMessage);
          setErrorMessage(null);
          setLoading(false);
        }
      }
    };

    if (loading) {
      setElapsedSeconds(0);
      void fetchStatus();
      intervalId = window.setInterval(fetchStatus, 1500);
      timerId = window.setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);
    } else {
      setScanStatus(null);
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

  const formattedPreview = useMemo(() => {
    if (!result) {
      return null;
    }

    const lines = [...result.data.previewNames];
    if (result.data.moreCount > 0) {
      lines.push(`...and ${result.data.moreCount} more`);
    }

    return lines;
  }, [result]);

  const loadDefaultChannels = async () => {
    try {
      const channels = await fetchDefaultChannels();
      setChannelInput((currentValue) => (currentValue ? currentValue : channels.join("\n")));
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);
    setResult(null);
    setActiveView("scan");
    setLoading(true);

    void runScan();
  };

  const handleCancel = async () => {
    if (!loading || cancelling) {
      return;
    }

    setCancelling(true);
    setErrorMessage(null);
    try {
      await cancelScan();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  const runScan = async () => {
    const userChannels = parseChannelInput(channelInput);

    try {
      await requestZeroMessageScan({
        channelNames: userChannels.length > 0 ? userChannels : undefined,
        countReactionsAsActivity,
        dryRun,
      });
    } catch (error) {
      const message = (error as Error).message;
      if (message.toLowerCase().includes("cancelled")) {
        setStatusMessage(message);
        setErrorMessage(null);
      } else {
        setErrorMessage(message);
        setStatusMessage(null);
      }
      setResult(null);
      setActiveView("scan");
      setLoading(false);
    }
  };

  return (
    <>
      {activeView === "scan" ? (
        <>
          <form onSubmit={handleSubmit} className={styles.controlPanel}>
            <label htmlFor="channelInput">
              Target channel names (newline or comma separated). Leave blank to use defaults from the config file.
            </label>
            <textarea
              id="channelInput"
              placeholder="general&#10;in-between"
              value={channelInput}
              onChange={(event) => setChannelInput(event.target.value)}
              rows={6}
              disabled={loading}
            />
            <label className={styles.dryRunToggle}>
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(event) => setDryRun(event.target.checked)}
                disabled={loading}
              />
              <span>Dry run (connect to Discord without scanning channels)</span>
            </label>
            <label className={styles.dryRunToggle}>
              <input
                type="checkbox"
                checked={countReactionsAsActivity}
                onChange={(event) => setCountReactionsAsActivity(event.target.checked)}
                disabled={loading}
              />
              <span>Count reactions as activity</span>
            </label>
            <div className={styles.actions}>
              <button type="submit" disabled={loading}>
                {loading ? "Scanning…" : "Scan for zero-message users"}
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
              {result && !loading && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setActiveView("results")}
                >
                  View last results
                </button>
              )}
            </div>

            {loading && (
              <div className={styles.scanProgress}>
                <p className={styles.elapsedTime}>
                  Elapsed scan time: {formattedElapsedTime}
                </p>
                <ProgressIndicator status={scanStatus} />
              </div>
            )}
          </form>

          <section className="feedback">
            {statusMessage && !result && <p className="status success">{statusMessage}</p>}
            {errorMessage && <p className="status error">{errorMessage}</p>}
          </section>
        </>
      ) : (
        result && (
          <ZeroScanResults
            result={result}
            previewLines={formattedPreview}
            statusMessage={statusMessage}
            onRunAnotherScan={() => {
              setActiveView("scan");
              setStatusMessage(null);
              setErrorMessage(null);
            }}
          />
        )
      )}
    </>
  );
};
