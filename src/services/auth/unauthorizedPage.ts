export const renderUnauthorizedPage = (reason: string): string => {
  const detail =
    reason === "not_in_guild"
      ? "Your Discord account is not a member of the configured server."
      : reason === "no_admin_guilds"
        ? "Your Discord account does not have the required moderation permissions in any server where this bot is installed."
        : "Your Discord account does not have the required moderation permissions in the configured server.";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Unauthorized</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f6f7fb;
        color: #111827;
      }
      main {
        max-width: 520px;
        margin: 10vh auto;
        padding: 32px;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 16px;
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
      }
      p {
        margin: 0 0 12px;
        line-height: 1.5;
      }
      a {
        color: #2563eb;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Unauthorized</h1>
      <p>Server management access is required to use this tool.</p>
      <p>${detail}</p>
      <p><a href="/auth/discord/login">Try a different Discord account</a></p>
    </main>
  </body>
</html>`;
};
