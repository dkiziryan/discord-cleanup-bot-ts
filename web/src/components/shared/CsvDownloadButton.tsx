import { buildCsvDownloadUrl } from "../../services/csv/csvFiles";

import styles from "./CsvDownloadButton.module.css";

type CsvDownloadButtonProps = {
  className?: string;
  filename: string;
  label?: string;
  size?: "default" | "compact";
};

export const CsvDownloadButton = ({
  className,
  filename,
  label = "Download CSV",
  size = "default",
}: CsvDownloadButtonProps) => {
  const classes = [
    "secondary-button",
    styles.button,
    size === "compact" ? styles.compact : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <a className={classes} href={buildCsvDownloadUrl(filename)}>
      {label}
    </a>
  );
};
