import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdminDashboardView } from "./AdminDashboard";
import type { AuthState } from "../../services/auth/auth";

const authorizedAuthState: AuthState = {
  status: "authorized",
  user: {
    avatarUrl: null,
    discordUserId: "user-1",
    isAuthorized: true,
    username: "tester",
    authorizedGuilds: [
      {
        id: "guild-1",
        name: "Test Guild",
      },
    ],
    selectedGuildId: "guild-1",
  },
};

const unauthorizedAuthState: AuthState = {
  status: "unauthorized",
  user: {
    avatarUrl: null,
    discordUserId: "user-2",
    isAuthorized: false,
    username: "blocked",
    authorizedGuilds: [],
    selectedGuildId: null,
  },
};

const renderDashboard = (authState: AuthState, authError: string | null = null) =>
  renderToString(
    <AdminDashboardView
      authController={{
        authError,
        authState,
        logout: async () => true,
        selectGuild: async () => undefined,
      }}
    />,
  );

describe("AdminDashboard", () => {
  it("renders the signed-in badge for an authorized user", () => {
    const html = renderDashboard(authorizedAuthState);

    expect(html).toContain("Signed in as");
  });

  it("renders the selected guild for an authorized user", () => {
    const html = renderDashboard(authorizedAuthState);

    expect(html).toContain("Test Guild");
  });

  it("renders dashboard tools for an authorized user", () => {
    const html = renderDashboard(authorizedAuthState);

    expect(html).toContain("Scan for zero messages");
    expect(html).toContain("CSV exports");
  });

  it("renders the unauthorized title for an unauthorized user", () => {
    const html = renderDashboard(
      unauthorizedAuthState,
      "Server management permission required.",
    );

    expect(html).toContain("Server management access required");
  });

  it("renders the unauthorized error for an unauthorized user", () => {
    const html = renderDashboard(
      unauthorizedAuthState,
      "Server management permission required.",
    );

    expect(html).toContain("Server management permission required.");
  });

  it("does not render dashboard tools for an unauthorized user", () => {
    const html = renderDashboard(
      unauthorizedAuthState,
      "Server management permission required.",
    );

    expect(html).not.toContain("Scan for zero messages");
  });
});
