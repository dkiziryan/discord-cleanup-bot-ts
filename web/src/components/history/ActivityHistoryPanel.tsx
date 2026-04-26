import { useEffect, useState } from "react";

import styles from "./ActivityHistoryPanel.module.css";
import type { JobHistoryItem } from "../../models/types";
import { fetchJobHistory } from "../../services/jobs/jobHistory";

export const ActivityHistoryPanel = () => {
  const [history, setHistory] = useState<JobHistoryItem[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      setLoading(true);
      setErrorMessage(null);
      try {
        const jobs = await fetchJobHistory();
        if (!cancelled) {
          setHistory(jobs);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage((error as Error).message);
          setHistory(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className={styles.panel}>
      <header>
        <h2>Activity history</h2>
        <p>Recent dashboard actions for the selected server.</p>
      </header>

      {loading && <p className={styles.empty}>Loading activity history...</p>}
      {errorMessage && <p className="status error">{errorMessage}</p>}
      {!loading && !errorMessage && history?.length === 0 && (
        <p className={styles.empty}>No activity yet.</p>
      )}
      {!loading && !errorMessage && history && history.length > 0 && (
        <ul className={styles.historyList}>
          {history.map((job) => (
            <li key={job.id}>
              <div>
                <strong>{formatJobType(job.type)}</strong>
                <span>{formatJobStatus(job.status)}</span>
              </div>
              <p>{job.errorMessage ?? job.summary}</p>
              <small>{formatJobDate(job.createdAt)}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

const formatJobType = (type: string): string => {
  switch (type) {
    case "zero_scan":
      return "Zero-message scan";
    case "inactive_scan":
      return "Inactive-member scan";
    case "kick_csv":
      return "Kick from CSV";
    case "cleanup_roles":
      return "Remove empty roles";
    case "archive_channels":
      return "Archive inactive channels";
    default:
      return "Dashboard action";
  }
};

const formatJobStatus = (status: string): string => {
  return status.replace(/_/g, " ");
};

const formatJobDate = (value: string): string => {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
};
