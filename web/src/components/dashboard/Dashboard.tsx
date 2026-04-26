import { useEffect, useMemo, useState, type ReactNode } from "react";

import styles from "./Dashboard.module.css";
import { ArchiveChannelsPanel } from "../archive/ArchiveChannelsPanel";
import { InactiveScanPanel } from "../inactivity/InactiveScanPanel";
import { KickFromCsvPanel } from "../kick/KickFromCsvPanel";
import { CleanupRolesPanel } from "../roles/CleanupRolesPanel";
import { ZeroMessageScanner } from "../zeroMessages/ZeroMessageScanner";
import { ActivityHistoryPanel } from "../history/ActivityHistoryPanel";
import { ServerSettingsPanel } from "../settings/ServerSettingsPanel";
import type { AuthUser } from "../../services/auth/auth";

export type PanelKey =
  | "zero"
  | "inactive"
  | "kick"
  | "roles"
  | "archive"
  | "settings"
  | "activity";

export type PanelRequest = {
  key: number;
  panel: PanelKey;
};

type DashboardPanel = {
  title: string;
  description: string;
  component: ReactNode;
};

export const Dashboard = ({
  activePanelRequest,
  user,
  onSelectGuild,
}: {
  activePanelRequest: PanelRequest | null;
  user: AuthUser;
  onSelectGuild: (guildId: string) => Promise<void>;
}) => {
  const [activePanel, setActivePanel] = useState<PanelKey | null>(null);
  const guilds = user?.authorizedGuilds ?? [];

  const activeGuild = guilds.find(
    (guild) => guild.id === user?.selectedGuildId,
  );

  useEffect(() => {
    if (activePanelRequest) {
      setActivePanel(activePanelRequest.panel);
    }
  }, [activePanelRequest]);

  const panels = useMemo<Record<PanelKey, DashboardPanel>>(
    () => ({
      zero: {
        title: "Scan for zero messages",
        description:
          "Identify members that never posted in your target channels and export a CSV.",
        component: <ZeroMessageScanner />,
      },
      inactive: {
        title: "Scan for inactive members",
        description:
          "Find members with no messages in the last N days while ignoring specific categories.",
        component: <InactiveScanPanel />,
      },
      kick: {
        title: "Kick from CSV",
        description:
          "Select one or more CSV exports and kick the matching members (or run a dry run).",
        component: <KickFromCsvPanel />,
      },
      roles: {
        title: "Remove empty roles",
        description:
          "Preview unused roles in your guild, then confirm deletion in one click.",
        component: <CleanupRolesPanel />,
      },
      archive: {
        title: "Archive inactive channels",
        description:
          "Find channels without recent activity and move them into an archive category.",
        component: <ArchiveChannelsPanel />,
      },
      settings: {
        title: "Server settings",
        description:
          "Manage per-server safety settings, including users ignored by moderation workflows.",
        component: <ServerSettingsPanel />,
      },
      activity: {
        title: "Activity history",
        description: "Review recent dashboard actions for this server.",
        component: <ActivityHistoryPanel />,
      },
    }),
    [],
  );

  const currentPanel = activePanel ? panels[activePanel] : null;
  const serverContext = (
    <div className={styles.serverContextCard}>
      <span className={styles.serverContextLabel}>Active server scope</span>
      <p>
        Managing{" "}
        <strong>{activeGuild?.name ?? "the selected Discord server"}</strong>.
        Switching servers returns you to the tool list.
      </p>
      {user.authorizedGuilds?.length > 1 && (
        <label className={styles.serverSelector}>
          <span>Server</span>
          <span className={styles.serverSelectorControl}>
            <select
              value={user.selectedGuildId ?? ""}
              onChange={(event) => {
                setActivePanel(null);
                void onSelectGuild(event.target.value);
              }}
            >
              {user.authorizedGuilds?.map((guild) => (
                <option key={guild.id} value={guild.id}>
                  {guild.name}
                </option>
              ))}
            </select>
            <span className={styles.serverSelectorChevron} aria-hidden="true">
              ↓
            </span>
          </span>
        </label>
      )}
    </div>
  );

  if (currentPanel) {
    return (
      <>
        {serverContext}
        <section className={styles.panelWrapper}>
          <div className={styles.panelHeader}>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setActivePanel(null)}
            >
              ← Back to all tools
            </button>
            <h2>{currentPanel.title}</h2>
          </div>
          {currentPanel.component}
        </section>
      </>
    );
  }

  return (
    <section>
      {serverContext}
      <ul className={styles.ctaList}>
        {Object.entries(panels)
          .filter(([key]) => key !== "activity")
          .map(([key, panel]) => (
            <li key={key}>
              <button
                type="button"
                className={styles.ctaPill}
                onClick={() => setActivePanel(key as PanelKey)}
              >
                <span className={styles.ctaPillText}>
                  <span className={styles.ctaPillTitle}>{panel.title}</span>
                  <span className={styles.ctaPillDescription}>
                    {panel.description}
                  </span>
                </span>
                <span className={styles.ctaPillChevron} aria-hidden="true">
                  →
                </span>
              </button>
            </li>
          ))}
      </ul>
    </section>
  );
};
