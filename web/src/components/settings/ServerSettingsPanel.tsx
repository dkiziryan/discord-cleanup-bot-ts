import { useEffect, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";

import styles from "./ServerSettingsPanel.module.css";
import type { IgnoredUser } from "../../models/types";
import {
  addIgnoredUser,
  fetchIgnoredUsers,
  ignoredUsersExportUrl,
  importIgnoredUsers,
  removeIgnoredUser,
} from "../../services/settings/ignoredUsers";

const DISCORD_USER_ID_PATTERN = /^\d{5,25}$/;

const hasImportableUserId = (contents: string): boolean => {
  const lines = contents.split(/\r?\n/);
  for (const line of lines.slice(1)) {
    const [candidate] = line.split(",");
    if (DISCORD_USER_ID_PATTERN.test(candidate.trim())) {
      return true;
    }
  }

  return false;
};

export const ServerSettingsPanel = () => {
  const [ignoredUsers, setIgnoredUsers] = useState<IgnoredUser[]>([]);
  const [discordUserId, setDiscordUserId] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadIgnoredUsers = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetchIgnoredUsers();
      setIgnoredUsers(response.users);
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadIgnoredUsers();
  }, []);

  const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) {
      return;
    }

    setSaving(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      await addIgnoredUser(discordUserId, username);
      setDiscordUserId("");
      setUsername("");
      setStatusMessage("Ignored user added.");
      await loadIgnoredUsers();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (userId: string) => {
    if (saving) {
      return;
    }

    setSaving(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      await removeIgnoredUser(userId);
      setStatusMessage("Ignored user removed.");
      await loadIgnoredUsers();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const importFile = async (file: File) => {
    if (!file || saving) {
      return;
    }

    setSaving(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      const contents = await file.text();
      if (!hasImportableUserId(contents)) {
        setErrorMessage(
          'No valid Discord user IDs found. Use a CSV with a "User ID" column.',
        );
        return;
      }

      const result = await importIgnoredUsers(contents);
      setStatusMessage(
        `Imported ${result.addedCount} user(s). ${result.skippedCount} duplicate(s) skipped.`,
      );
      await loadIgnoredUsers();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setSaving(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleImportInput = () => {
    const file = fileInputRef.current?.files?.[0];
    if (file) {
      void importFile(file);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!saving) {
      setDragActive(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragActive(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void importFile(file);
    }
  };

  return (
    <section className={styles.panel}>
      <header>
        <div>
          <h2>Server settings</h2>
          <p>
            Settings here apply only to the currently selected Discord server.
          </p>
        </div>
      </header>

      <section className={styles.ignoreSection}>
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.eyebrow}>Ignore list</span>
            <h3>{ignoredUsers.length} ignored user(s)</h3>
          </div>
          <a className="secondary-button" href={ignoredUsersExportUrl}>
            Export CSV
          </a>
        </div>

        <form className={styles.addForm} onSubmit={handleAdd}>
          <label>
            Discord user ID
            <input
              value={discordUserId}
              onChange={(event) => setDiscordUserId(event.target.value)}
              placeholder="123456789012345678"
              disabled={saving}
            />
          </label>
          <label>
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="optional for now"
              disabled={saving}
            />
          </label>
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? "Saving..." : "Add user"}
          </button>
        </form>

        <div
          className={`${styles.importRow} ${dragActive ? styles.importRowActive : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div>
            <strong>Import ignored users CSV</strong>
            <p>
              Expected format: first column header <code>User ID</code>, with
              one Discord user ID per row. A second <code>Username</code> column
              is allowed and ignored.
            </p>
            <pre className={styles.csvExample}>
              User ID,Username{"\n"}702612734893883434,example_user
            </pre>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleImportInput}
            disabled={saving}
            className={styles.fileInput}
          />
          <button
            type="button"
            className="secondary-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={saving}
          >
            Choose CSV
          </button>
          <span className={styles.dropHint}>or drag and drop a CSV here</span>
        </div>

        <div className="feedback">
          {statusMessage && <p className="status success">{statusMessage}</p>}
          {errorMessage && <p className="status error">{errorMessage}</p>}
        </div>

        {loading ? (
          <p className={styles.empty}>Loading ignored users...</p>
        ) : ignoredUsers.length === 0 ? (
          <p className={styles.empty}>No ignored users for this server.</p>
        ) : (
          <ul className={styles.userList}>
            {ignoredUsers.map((user) => (
              <li key={user.id}>
                <span className={styles.userPrimary}>
                  {user.username ? <strong>{user.username}</strong> : null}
                  <code>{user.discordUserId}</code>
                </span>
                <span className={styles.addedDate}>
                  {new Date(user.createdAt).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  className="secondary-button secondary-button--danger"
                  onClick={() => void handleRemove(user.discordUserId)}
                  disabled={saving}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
};
