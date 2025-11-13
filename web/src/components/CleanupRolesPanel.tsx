import { useMemo, useState } from "react";

import type { CleanupRolesResponse } from "../models/types";
import { requestRoleCleanup } from "../services/cleanupRoles";

export const CleanupRolesPanel = () => {
  const [previewResult, setPreviewResult] = useState<CleanupRolesResponse | null>(null);
  const [finalResult, setFinalResult] = useState<CleanupRolesResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const previewNames = useMemo(() => {
    if (!previewResult) {
      return [];
    }

    const names = [...previewResult.data.previewNames];
    if (previewResult.data.moreCount > 0) {
      names.push(`...and ${previewResult.data.moreCount} more`);
    }
    return names;
  }, [previewResult]);

  const handleCheck = async () => {
    if (checking) {
      return;
    }

    setChecking(true);
    setStatusMessage(null);
    setErrorMessage(null);
    setFinalResult(null);

    try {
      const response = await requestRoleCleanup({ dryRun: true });
      setPreviewResult(response);
      setStatusMessage(response.message);
    } catch (error) {
      setErrorMessage((error as Error).message);
      setPreviewResult(null);
    } finally {
      setChecking(false);
    }
  };

  const handleConfirm = async () => {
    if (!previewResult || previewResult.data.deletableRoleCount === 0 || confirming) {
      return;
    }

    setConfirming(true);
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      const response = await requestRoleCleanup({ dryRun: false });
      setFinalResult(response);
      setStatusMessage(response.message);
      setPreviewResult(null);
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setConfirming(false);
    }
  };

  const handleCancelPreview = () => {
    if (confirming) {
      return;
    }
    setPreviewResult(null);
    setStatusMessage(null);
    setErrorMessage(null);
  };

  const handleReset = () => {
    setFinalResult(null);
    setPreviewResult(null);
    setStatusMessage(null);
    setErrorMessage(null);
  };

  return (
    <section className="roles-panel">
      <div className="roles-panel__header">
        <h2>Clean up empty roles</h2>
        <p>Run a dry run to preview unused roles, then confirm to delete them safely.</p>
      </div>

      <div className="roles-panel__card">
        <p>
          The bot inspects every role in your configured guild, filters zero-member roles, and always runs a dry run first
          so you know exactly what will be removed.
        </p>
        <button
          type="button"
          className="primary-button"
          onClick={handleCheck}
          disabled={checking || confirming}
        >
          {checking ? "Checking…" : "Check for empty roles"}
        </button>

        {previewResult && (
          <div className="roles-panel__preview">
            <h3>Preview results</h3>
            <p>
              {previewResult.data.deletableRoleCount === 0
                ? "No empty roles are pending deletion."
                : `Found ${previewResult.data.deletableRoleCount} role(s) with zero members.`}
            </p>
            {previewNames.length > 0 && (
              <ul className="roles-panel__list">
                {previewNames.map((name, index) => (
                  <li key={`${name}-${index}`}>{name}</li>
                ))}
              </ul>
            )}
            {previewResult.data.deletableRoleCount > 0 && (
              <div className="roles-panel__confirm-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleConfirm}
                  disabled={confirming}
                >
                  {confirming ? "Cleaning up…" : `Delete ${previewResult.data.deletableRoleCount} role(s)`}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleCancelPreview}
                  disabled={confirming}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {finalResult && (
          <div className="roles-panel__result">
            <h3>Cleanup summary</h3>
            <ul>
              <li>
                Removed roles: <strong>{finalResult.data.deletedRoleCount}</strong>
              </li>
              <li>
                Guild: <strong>{finalResult.data.guildName}</strong>
              </li>
            </ul>
            {finalResult.data.failures.length > 0 && (
              <details>
                <summary>{finalResult.data.failures.length} issue(s)</summary>
                <ul>
                  {finalResult.data.failures.map((failure, index) => (
                    <li key={`${failure}-${index}`}>{failure}</li>
                  ))}
                </ul>
              </details>
            )}
            <button type="button" className="secondary-button" onClick={handleReset}>
              Run another cleanup
            </button>
          </div>
        )}
      </div>

      <div className="feedback">
        {statusMessage && <p className="status success">{statusMessage}</p>}
        {errorMessage && <p className="status error">{errorMessage}</p>}
      </div>
    </section>
  );
};
