import type { ResultsPageProps } from "../models/types";
import { ResultTile } from "./ResultTile";

export const ZeroScanResults = ({
  result,
  previewLines,
  statusMessage,
  onRunAnotherScan,
}: ResultsPageProps) => {
  const { data } = result;
  const previewList = previewLines ?? [];
  const hasPreview = previewList.length > 0;
  const hasProcessedChannels = data.processedChannels.length > 0;
  const hasSkippedChannels = data.skippedChannels.length > 0;

  return (
    <section className="results-page">
      <div className="results-page__header">
        <div>
          <h2>Scan results</h2>
          <p className="results-page__subtitle">
            CSV saved to <code>{data.csvPath}</code>
          </p>
        </div>
        <div className="results-page__actions">
          <button type="button" className="secondary-button" onClick={onRunAnotherScan}>
            Run another scan
          </button>
        </div>
      </div>

      {statusMessage && <p className="status success results-status">{statusMessage}</p>}

      <div className="results-page__grid result-grid">
        <ResultTile label="Guild" value={data.guildName} />
        <ResultTile label="Zero-message users" value={data.zeroMessageCount} />
        <ResultTile label="Members checked" value={data.totalMembersChecked} />
        <ResultTile label="Messages scanned" value={data.totalMessagesScanned} />
      </div>

      <div className="results-page__details">
        <article className="results-card">
          <h3>Zero-message preview</h3>
          {hasPreview ? (
            <ul>
              {previewList.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="results-card__empty">
              {data.zeroMessageCount === 0
                ? "Everyone has posted in the selected channels."
                : "No preview available for the current selection."}
            </p>
          )}
        </article>

        <article className="results-card">
          <h3>Channel summary</h3>
          <div className="results-card__channels">
            <div className="channel-column">
              <h4>Processed</h4>
              {hasProcessedChannels ? (
                <ul>
                  {data.processedChannels.map((channel) => (
                    <li key={channel}>{channel}</li>
                  ))}
                </ul>
              ) : (
                <p className="results-card__empty">No channels processed.</p>
              )}
            </div>
            <div className="channel-column">
              <h4>Skipped</h4>
              {hasSkippedChannels ? (
                <ul>
                  {data.skippedChannels.map((channel) => (
                    <li key={channel}>{channel}</li>
                  ))}
                </ul>
              ) : (
                <p className="results-card__empty">No channels were skipped.</p>
              )}
            </div>
          </div>
        </article>
      </div>
    </section>
  );
};
