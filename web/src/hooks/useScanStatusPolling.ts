import { useEffect, useRef, useState } from "react";

type ScanStatusPollingOptions<TStatus> = {
  loading: boolean;
  onStatus: (status: TStatus | null) => void;
  onStop: () => void;
  pollStatus: () => Promise<TStatus | null>;
  pollIntervalMs?: number;
};

const DEFAULT_POLL_INTERVAL_MS = 1500;

export const useScanStatusPolling = <TStatus>({
  loading,
  onStatus,
  onStop,
  pollStatus,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: ScanStatusPollingOptions<TStatus>): number => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const callbacksRef = useRef({ onStatus, onStop, pollStatus });

  useEffect(() => {
    callbacksRef.current = { onStatus, onStop, pollStatus };
  });

  useEffect(() => {
    if (!loading) {
      callbacksRef.current.onStop();
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();

    const poll = async () => {
      const status = await callbacksRef.current.pollStatus();
      if (!cancelled) {
        callbacksRef.current.onStatus(status);
      }
    };

    setElapsedSeconds(0);
    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, pollIntervalMs);
    const timerId = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.clearInterval(timerId);
    };
  }, [loading, pollIntervalMs]);

  return elapsedSeconds;
};
