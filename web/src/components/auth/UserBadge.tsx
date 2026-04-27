import { useEffect, useRef, useState } from "react";

import styles from "./UserBadge.module.css";
import type { AuthUser } from "../../services/auth/auth";
import type { LocalDevSettings } from "../../models/types";
import {
  fetchLocalDevSettings,
  updateLocalDevSettings,
} from "../../services/settings/localDevSettings";

export const UserBadge = ({
  user,
  onOpenActivityHistory,
  onLogout,
}: {
  user: AuthUser;
  onOpenActivityHistory: () => void;
  onLogout: () => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [localDevSettings, setLocalDevSettings] =
    useState<LocalDevSettings | null>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const loadLocalDevSettings = async () => {
      try {
        const settings = await fetchLocalDevSettings();
        if (!cancelled) {
          setLocalDevSettings(settings);
        }
      } catch {
        if (!cancelled) {
          setLocalDevSettings(null);
        }
      }
    };

    void loadLocalDevSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (
        accountRef.current &&
        !accountRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const openActivityHistory = () => {
    setMenuOpen(false);
    onOpenActivityHistory();
  };
  const handleProductionDataToggle = async (enabled: boolean) => {
    const settings = await updateLocalDevSettings(enabled);
    setLocalDevSettings(settings);
    window.location.reload();
  };
  const initials = buildInitials(user.username);

  return (
    <div className={styles.account} ref={accountRef}>
      <button
        type="button"
        className={styles.accountTrigger}
        onClick={() => setMenuOpen((current) => !current)}
        aria-label="Open account menu"
        aria-expanded={menuOpen}
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className={styles.avatar} />
        ) : (
          <span className={styles.initials}>{initials}</span>
        )}
        <span className={styles.userIdentity}>
          <span className={styles.label}>Signed in as</span>
          <strong>{user.username}</strong>
        </span>
        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </button>

      {menuOpen && (
        <div className={styles.menu}>
          <div className={styles.menuSectionLabel}>Account</div>
          <div className={styles.menuIdentity}>
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className={styles.menuAvatar} />
            ) : (
              <span className={styles.menuInitials}>{initials}</span>
            )}
            <strong>{user.username}</strong>
          </div>
          <button type="button" onClick={openActivityHistory}>
            Activity history
          </button>
          {localDevSettings?.available && (
            <label className={styles.menuToggle}>
              <span>Use production data</span>
              <span className={styles.switchControl}>
                <input
                  type="checkbox"
                  className={styles.switchInput}
                  checked={localDevSettings.useProductionData}
                  onChange={(event) =>
                    void handleProductionDataToggle(event.target.checked)
                  }
                />
                <span className={styles.switchTrack} aria-hidden="true" />
              </span>
            </label>
          )}
          <button type="button" onClick={onLogout}>
            Logout
          </button>
        </div>
      )}
    </div>
  );
};

const buildInitials = (username: string): string => {
  const initials = username
    .split(/\s+/)
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return initials || "U";
};
