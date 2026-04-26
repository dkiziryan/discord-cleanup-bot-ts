import "../../App.css";

import styles from "./AdminDashboard.module.css";
import { AuthCard } from "../auth/AuthCard";
import { UserBadge } from "../auth/UserBadge";
import { useAuthState } from "../../hooks/useAuthState";
import { Dashboard, type PanelRequest } from "./Dashboard";
import type { AuthState } from "../../services/auth/auth";
import { BotInviteCallout } from "./BotInviteCallout";
import { BOT_INVITE_URL } from "../../config/appLinks";
import { useState } from "react";

export type AdminDashboardAuthController = {
  authError: string | null;
  authState: AuthState;
  logout: () => Promise<boolean>;
  selectGuild: (guildId: string) => Promise<void>;
};

const loginWithDiscord = () => {
  window.location.href = "/auth/discord/login";
};

export const AdminDashboard = () => (
  <AdminDashboardView authController={useAuthState()} />
);

export const AdminDashboardView = ({
  authController,
}: {
  authController: AdminDashboardAuthController;
}) => {
  const { authError, authState, logout, selectGuild } = authController;
  const [activePanelRequest, setActivePanelRequest] =
    useState<PanelRequest | null>(null);

  const openActivityHistory = () => {
    setActivePanelRequest({
      key: Date.now(),
      panel: "activity",
    });
  };

  return (
    <div className={styles.app}>
      <header className={styles.hero}>
        <div className={styles.heroContent}>
          <p className={styles.heroEyebrow}>Welcome to</p>
          <h1>Discord Admin Console</h1>
          <p>
            Moderation and server management dashboard for Discord admins. Use
            guided workflows to review inactive members, manage roles, archive
            stale channels, and act on curated CSV exports.
          </p>
        </div>
        {authState.status === "authorized" && (
          <UserBadge
            user={authState.user}
            onOpenActivityHistory={openActivityHistory}
            onLogout={logout}
          />
        )}
      </header>

      <main>
        {authState.status !== "authorized" && (
          <BotInviteCallout botInviteUrl={BOT_INVITE_URL} />
        )}

        {authState.status === "loading" && (
          <AuthCard
            title="Checking access"
            description="Verifying your Discord session before loading the admin dashboard."
          />
        )}

        {authState.status === "unauthenticated" && (
          <AuthCard
            title="Sign in with Discord"
            description="Use your Discord account to access the admin dashboard."
            detail="After login, you can choose any server where this bot is installed and your Discord account has Administrator, Manage Server, Manage Roles, Manage Channels, or Kick Members permission."
            error={authError}
            actionLabel="Login with Discord"
            onAction={loginWithDiscord}
          />
        )}

        {authState.status === "unauthorized" && (
          <AuthCard
            title="Server management access required"
            description="You are signed in, but this account is not authorized for any server available to this bot."
            detail="Access is limited to Discord users with Administrator, Manage Server, Manage Roles, Manage Channels, or Kick Members permission in a server where the bot is installed."
            error={authError}
            actionLabel="Try a different Discord account"
            onAction={loginWithDiscord}
          />
        )}

        {authState.status === "authorized" && (
          <Dashboard
            activePanelRequest={activePanelRequest}
            user={authState.user}
            onSelectGuild={selectGuild}
          />
        )}
      </main>
    </div>
  );
};
