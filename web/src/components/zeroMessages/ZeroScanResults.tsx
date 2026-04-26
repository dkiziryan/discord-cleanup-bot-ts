import styles from "./ZeroScanResults.module.css";
import type { ResultsPageProps } from "../../models/types";
import { CsvDownloadButton } from "../shared/CsvDownloadButton";
import { ResultTile } from "../shared/ResultTile";

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
    <section className={styles.page}>
      <div className={styles.header}>
        <div>
          <h2>Scan results</h2>
          <p className={styles.subtitle}>
            CSV saved to <code>{data.csvPath}</code>
          </p>
        </div>
        <div className={styles.actions}>
          <CsvDownloadButton filename={data.csvPath} />
          <button type="button" className="secondary-button" onClick={onRunAnotherScan}>
            Run another scan
          </button>
        </div>
      </div>

      {statusMessage && <p className={`status success ${styles.status}`}>{statusMessage}</p>}

      <div className="result-grid">
        <ResultTile label="Guild" value={data.guildName} />
        <ResultTile label="Zero-message users" value={data.zeroMessageCount} />
        <ResultTile label="Members checked" value={data.totalMembersChecked} />
        <ResultTile label="Messages scanned" value={data.totalMessagesScanned} />
      </div>

      <div className={styles.details}>
        <article className={styles.card}>
          <h3>Zero-message preview</h3>
          {hasPreview ? (
            <ul>
              {previewList.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>
              {data.zeroMessageCount === 0
                ? "Everyone has posted in the selected channels."
                : "No preview available for the current selection."}
            </p>
          )}
        </article>

        <article className={styles.card}>
          <h3>Channel summary</h3>
          <div className={styles.channels}>
            <div className={styles.channelColumn}>
              <h4>Processed</h4>
              {hasProcessedChannels ? (
                <ul>
                  {data.processedChannels.map((channel) => (
                    <li key={channel}>{channel}</li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>No channels processed.</p>
              )}
            </div>
            <div className={styles.channelColumn}>
              <h4>Skipped</h4>
              {hasSkippedChannels ? (
                <ul>
                  {data.skippedChannels.map((channel) => (
                    <li key={channel}>{channel}</li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>No channels were skipped.</p>
              )}
            </div>
          </div>
        </article>
      </div>
    </section>
  );
};
