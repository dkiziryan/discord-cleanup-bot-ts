import { useState } from "react";

import styles from "./UserBadge.module.css";
import type { AuthUser } from "../../services/auth/auth";
import type { JobHistoryItem } from "../../models/types";
import { fetchJobHistory } from "../../services/jobs/jobHistory";

export const UserBadge = ({
  user,
  onLogout,
}: {
  user: AuthUser;
  onLogout: () => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [history, setHistory] = useState<JobHistoryItem[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const toggleMenu = () => {
    const nextOpen = !menuOpen;
    setMenuOpen(nextOpen);

    if (nextOpen && !loadingHistory) {
      setLoadingHistory(true);
      setHistoryError(null);
      void fetchJobHistory()
        .then((jobs) => setHistory(jobs))
        .catch((error) => setHistoryError((error as Error).message))
        .finally(() => setLoadingHistory(false));
    }
  };

  return (
    <div className={styles.account}>
      <div className={styles.badge}>
        {user.avatarUrl && (
          <img src={user.avatarUrl} alt="" className={styles.avatar} />
        )}
        <button
          type="button"
          className={styles.userMenuButton}
          onClick={toggleMenu}
          aria-expanded={menuOpen}
        >
          <span className={styles.label}>Signed in as</span>
          <strong>{user.username}</strong>
        </button>
        <button type="button" onClick={onLogout}>
          Logout
        </button>
      </div>

      {menuOpen && (
        <div className={styles.menu}>
          <div className={styles.menuHeader}>
            <strong>Activity history</strong>
          </div>
          {loadingHistory && <p className={styles.empty}>Loading history…</p>}
          {historyError && <p className={styles.error}>{historyError}</p>}
          {!loadingHistory && !historyError && history?.length === 0 && (
            <p className={styles.empty}>No activity yet.</p>
          )}
          {!loadingHistory && !historyError && history && history.length > 0 && (
            <ul className={styles.historyList}>
              {history.map((job) => (
                <li key={job.id}>
                  <span className={styles.jobTitle}>{formatJobType(job.type)}</span>
                  <span className={styles.jobSummary}>
                    {job.errorMessage ?? job.summary}
                  </span>
                  <span className={styles.jobMeta}>
                    {formatJobStatus(job.status)} · {formatJobDate(job.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
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
