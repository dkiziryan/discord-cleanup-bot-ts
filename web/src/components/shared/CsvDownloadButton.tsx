import { buildCsvDownloadUrl } from "../../services/csv/csvFiles";

import styles from "./CsvDownloadButton.module.css";

type CsvDownloadButtonProps = {
  className?: string;
  filename: string;
  iconOnly?: boolean;
  label?: string;
  size?: "default" | "compact";
};

export const CsvDownloadButton = ({
  className,
  filename,
  iconOnly = false,
  label = "Download CSV",
  size = "default",
}: CsvDownloadButtonProps) => {
  const classes = [
    "secondary-button",
    styles.button,
    size === "compact" ? styles.compact : "",
    iconOnly ? styles.iconOnly : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <a
      aria-label={iconOnly ? label : undefined}
      className={classes}
      href={buildCsvDownloadUrl(filename)}
      title={iconOnly ? label : undefined}
    >
      {iconOnly ? (
        <svg
          aria-hidden="true"
          className={styles.icon}
          focusable="false"
          viewBox="0 0 24 24"
        >
          <path d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1Z" />
          <path d="M5 18a1 1 0 0 1 1 1h12a1 1 0 1 1 0 2H6a3 3 0 0 1-3-3 1 1 0 1 1 2 0Z" />
        </svg>
      ) : (
        label
      )}
    </a>
  );
};
