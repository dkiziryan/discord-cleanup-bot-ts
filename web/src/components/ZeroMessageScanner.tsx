import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import type { ScanResponse, ScanStatus } from "../models/types";
import { fetchDefaultChannels } from "../services/defaultChannels";
import { cancelScan } from "../services/cancelScan";
import { fetchScanStatus } from "../services/scanStatus";
import { requestZeroMessageScan } from "../services/zeroMessages";
import { parseChannelInput } from "../utils/channel";
import { ProgressIndicator } from "./ProgressIndicator";
import { ZeroScanResults } from "./ZeroScanResults";

export const ZeroMessageScanner = () => {
  const [channelInput, setChannelInput] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [activeView, setActiveView] = useState<"scan" | "results">("scan");
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    void loadDefaultChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | undefined;

    const fetchStatus = async () => {
      const payload = await fetchScanStatus();
      if (!cancelled && payload) {
        setScanStatus(payload);
      }
    };

    if (loading) {
      void fetchStatus();
      intervalId = window.setInterval(fetchStatus, 1500);
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

  async function loadDefaultChannels() {
    try {
      const channels = await fetchDefaultChannels();
      if (!channelInput) {
        setChannelInput(channels.join("\n"));
      }
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  }

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

  async function runScan() {
    const userChannels = parseChannelInput(channelInput);

    try {
      const payload = await requestZeroMessageScan({
        channelNames: userChannels.length > 0 ? userChannels : undefined,
        dryRun,
      });
      setResult(payload);
      setStatusMessage(payload.message);
      setActiveView("results");
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
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {activeView === "scan" ? (
        <>
          <form onSubmit={handleSubmit} className="control-panel">
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
            <label className="dry-run-toggle">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(event) => setDryRun(event.target.checked)}
                disabled={loading}
              />
              <span>Dry run (connect to Discord without scanning channels)</span>
            </label>
            <div className="control-panel__actions">
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
              <div className="scan-progress">
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
