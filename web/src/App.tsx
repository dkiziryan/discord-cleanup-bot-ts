import { useMemo, useState } from "react";

import "./App.css";

import { InactiveScanPanel } from "./components/InactiveScanPanel";
import { KickFromCsvPanel } from "./components/KickFromCsvPanel";
import { ZeroMessageScanner } from "./components/ZeroMessageScanner";

type PanelKey = "zero" | "inactive" | "kick";

export const App = () => {
  const [activePanel, setActivePanel] = useState<PanelKey | null>(null);

  const panels = useMemo(
    () => ({
      zero: {
        title: "Scan for zero messages",
        description: "Identify members that never posted in your target channels and export a CSV.",
        component: <ZeroMessageScanner />,
      },
      inactive: {
        title: "Scan for inactive members",
        description: "Find members with no messages in the last N days while ignoring specific categories.",
        component: <InactiveScanPanel />,
      },
      kick: {
        title: "Kick from CSV",
        description: "Select one or more CSV exports and kick the matching members (or run a dry run).",
        component: <KickFromCsvPanel />,
      },
    }),
    [],
  );

  const currentPanel = activePanel ? panels[activePanel] : null;

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="hero__eyebrow">Welcome to</p>
          <h1>Discord Cleanup Bot</h1>
          <p>
            Keep your server tidy with guided tools to surface zero-message users, highlight inactive members, or
            kick from curated CSV exports. Choose a workflow to get started.
          </p>
        </div>
      </header>

      <main>
        {!currentPanel && (
          <section className="cta-grid">
            {Object.entries(panels).map(([key, panel]) => (
              <article key={key} className="cta-card">
                <h2>{panel.title}</h2>
                <p>{panel.description}</p>
                <button
                  type="button"
                  className="primary-button cta-card__button"
                  onClick={() => setActivePanel(key as PanelKey)}
                >
                  Open tool
                </button>
              </article>
            ))}
          </section>
        )}

        {currentPanel && (
          <section className="panel-wrapper">
            <div className="panel-header">
              <button type="button" className="secondary-button" onClick={() => setActivePanel(null)}>
                ← Back to all tools
              </button>
              <h2>{currentPanel.title}</h2>
            </div>
            {currentPanel.component}
          </section>
        )}
      </main>
    </div>
  );
};

export default App;
