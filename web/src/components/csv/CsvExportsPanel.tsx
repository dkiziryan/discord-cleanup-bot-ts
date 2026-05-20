import { useEffect, useMemo, useState } from "react";

import styles from "./CsvExportsPanel.module.css";
import type { CsvFileMetadata, CsvRowsResponse } from "../../models/types";
import { fetchCsvFiles, fetchCsvRows } from "../../services/csv/csvFiles";
import { CsvDownloadButton } from "../shared/CsvDownloadButton";

const PAGE_SIZE = 25;

export const CsvExportsPanel = () => {
  const [files, setFiles] = useState<CsvFileMetadata[]>([]);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<CsvRowsResponse | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadFiles = async () => {
      setLoadingFiles(true);
      setErrorMessage(null);
      try {
        const fetchedFiles = await fetchCsvFiles();
        if (!cancelled) {
          setFiles(fetchedFiles);
          setSelectedFilename((current) =>
            current && fetchedFiles.some((file) => file.filename === current)
              ? current
              : (fetchedFiles[0]?.filename ?? null),
          );
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage((error as Error).message);
          setFiles([]);
          setSelectedFilename(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingFiles(false);
        }
      }
    };

    void loadFiles();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshFiles = async () => {
    setLoadingFiles(true);
    setErrorMessage(null);
    try {
      const fetchedFiles = await fetchCsvFiles();
      setFiles(fetchedFiles);
      setSelectedFilename((current) =>
        current && fetchedFiles.some((file) => file.filename === current)
          ? current
          : (fetchedFiles[0]?.filename ?? null),
      );
    } catch (error) {
      setErrorMessage((error as Error).message);
      setFiles([]);
      setSelectedFilename(null);
    } finally {
      setLoadingFiles(false);
    }
  };

  useEffect(() => {
    if (!selectedFilename) {
      setCsvRows(null);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      const loadRows = async () => {
        setLoadingRows(true);
        setErrorMessage(null);
        try {
          const rows = await fetchCsvRows({
            filename: selectedFilename,
            page,
            pageSize: PAGE_SIZE,
            search,
          });
          if (!cancelled) {
            setCsvRows(rows);
            if (rows.page !== page) {
              setPage(rows.page);
            }
          }
        } catch (error) {
          if (!cancelled) {
            setErrorMessage((error as Error).message);
            setCsvRows(null);
          }
        } finally {
          if (!cancelled) {
            setLoadingRows(false);
          }
        }
      };

      void loadRows();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [page, search, selectedFilename]);

  const selectedFile = useMemo(
    () => files.find((file) => file.filename === selectedFilename) ?? null,
    [files, selectedFilename],
  );

  const handleSelectFile = (filename: string) => {
    setSelectedFilename(filename);
    setSearch("");
    setPage(1);
    setCsvRows(null);
  };

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <h2>CSV exports</h2>
          <p>Review generated exports without downloading the full file.</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={refreshFiles}
          disabled={loadingFiles}
        >
          Refresh
        </button>
      </div>

      {errorMessage && <p className="status error">{errorMessage}</p>}

      <div className={styles.layout}>
        <aside className={styles.fileList}>
          {loadingFiles ? (
            <p className={styles.empty}>Loading CSV exports...</p>
          ) : files.length === 0 ? (
            <p className={styles.empty}>No CSV exports found.</p>
          ) : (
            <ul>
              {files.map((file) => (
                <li
                  key={file.filename}
                  className={`${styles.fileItem} ${
                    file.filename === selectedFilename ? styles.selectedFile : ""
                  }`}
                >
                  <button
                    type="button"
                    className={styles.fileButton}
                    onClick={() => handleSelectFile(file.filename)}
                  >
                    <strong>{file.filename}</strong>
                    <small>
                      {formatCsvFileDetail(file)}
                    </small>
                  </button>
                  <CsvDownloadButton
                    className={styles.fileDownload}
                    filename={file.filename}
                    iconOnly
                    label={`Download ${file.filename}`}
                    size="compact"
                  />
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className={styles.viewer}>
          {!selectedFile ? (
            <p className={styles.empty}>Select a CSV export to view rows.</p>
          ) : (
            <>
              <div className={styles.viewerHeader}>
                <div>
                  <h3>{selectedFile.filename}</h3>
                  <p>
                    {csvRows
                      ? `${csvRows.totalRows} matching row${
                          csvRows.totalRows === 1 ? "" : "s"
                        }`
                      : "Open the file to load rows"}
                  </p>
                </div>
                <label className={styles.searchLabel}>
                  Search by name
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => handleSearch(event.target.value)}
                    placeholder="Username"
                  />
                </label>
              </div>

              {loadingRows && <p className={styles.empty}>Loading rows...</p>}
              {!loadingRows && csvRows && csvRows.rows.length === 0 && (
                <p className={styles.empty}>No rows match this search.</p>
              )}
              {!loadingRows && csvRows && csvRows.rows.length > 0 && (
                <>
                  <div className={styles.tableWrap}>
                    <table>
                      <thead>
                        <tr>
                          {csvRows.columns.map((column) => (
                            <th key={column}>{column}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {csvRows.rows.map((row, rowIndex) => (
                          <tr key={`${csvRows.page}-${rowIndex}`}>
                            {csvRows.columns.map((column) => (
                              <td key={column}>{row[column]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className={styles.pagination}>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={csvRows.page <= 1}
                      onClick={() =>
                        setPage((current) => Math.max(1, current - 1))
                      }
                    >
                      Previous
                    </button>
                    <span className={styles.pageCount}>
                      Page {csvRows.page} of {csvRows.totalPages}
                    </span>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={csvRows.page >= csvRows.totalPages}
                      onClick={() =>
                        setPage((current) =>
                          Math.min(csvRows.totalPages, current + 1),
                        )
                      }
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
};

const formatCsvFileDetail = (file: CsvFileMetadata): string => {
  const modifiedAt = new Date(file.modifiedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const size = formatBytes(file.size);
  const rowDetail =
    typeof file.rowCount === "number" ? `${file.rowCount} rows` : size;

  return `${rowDetail} · ${modifiedAt}`;
};

const formatBytes = (size: number): string => {
  if (!Number.isFinite(size) || size < 0) {
    return "Unknown size";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  const kilobytes = size / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(1)} KB`;
  }

  return `${(kilobytes / 1024).toFixed(1)} MB`;
};
