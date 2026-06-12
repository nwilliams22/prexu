import { useState } from "react";
import { createPortal } from "react-dom";
import { useDownloads } from "../../hooks/useDownloads";
import { buildDownloadItem } from "./DownloadButton";
import { logger } from "../../services/logger";
import type { PlexEpisode } from "../../types/library";
import type { DownloadItem } from "../../types/downloads";

interface BulkDownloadButtonProps {
  /** Button label, e.g. "Download Season" / "Download Series" */
  label: string;
  /** Noun used in the confirm dialog, e.g. "season" / "series" */
  noun: string;
  serverUri: string;
  /** Fetch (or return already-loaded) episodes with Media[].Part[] data */
  getEpisodes: () => Promise<PlexEpisode[]>;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export default function BulkDownloadButton({
  label,
  noun,
  serverUri,
  getEpisodes,
}: BulkDownloadButtonProps) {
  const { isDownloaded, isDownloading, queueDownload } = useDownloads();
  const [pending, setPending] = useState<DownloadItem[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    logger.info("downloads", "bulk download requested", { noun });
    try {
      const episodes = await getEpisodes();
      const items = episodes
        .map((ep) => buildDownloadItem(ep, serverUri))
        .filter((item): item is DownloadItem => item !== null);
      const fresh = items.filter(
        (item) => !isDownloaded(item.ratingKey) && !isDownloading(item.ratingKey),
      );
      setSkipped(items.length - fresh.length);
      setPending(fresh);
      logger.info("downloads", "bulk download candidates", {
        total: items.length,
        fresh: fresh.length,
      });
    } catch (err) {
      logger.error("downloads", "bulk download episode fetch failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (!pending) return;
    logger.info("downloads", "bulk download confirmed", { count: pending.length });
    pending.forEach(queueDownload);
    setPending(null);
  };

  const totalBytes = pending?.reduce((sum, item) => sum + item.fileSize, 0) ?? 0;

  return (
    <>
      <button onClick={handleClick} disabled={loading} style={styles.button}>
        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1={12} y1={15} x2={12} y2={3} />
        </svg>
        {loading ? "Loading..." : label}
      </button>

      {pending !== null &&
        createPortal(
          <div style={styles.overlay} onClick={() => setPending(null)}>
            <div
              style={styles.dialog}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={`Confirm ${noun} download`}
            >
              <h3 style={styles.dialogTitle}>Download entire {noun}?</h3>
              {pending.length > 0 ? (
                <p style={styles.dialogBody}>
                  This will download <strong>{pending.length} episode{pending.length !== 1 ? "s" : ""}</strong>
                  {totalBytes > 0 && <> ({formatBytes(totalBytes)})</>} to this device.
                  {skipped > 0 && <> {skipped} already downloaded or in progress will be skipped.</>}
                </p>
              ) : (
                <p style={styles.dialogBody}>
                  Nothing to download — every episode is already downloaded or in progress.
                </p>
              )}
              <div style={styles.dialogActions}>
                <button onClick={() => setPending(null)} style={styles.cancelBtn}>
                  Cancel
                </button>
                {pending.length > 0 && (
                  <button onClick={handleConfirm} style={styles.confirmBtn}>
                    Download {pending.length}
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  button: {
    display: "flex",
    alignItems: "center",
    gap: "0.45rem",
    padding: "0.45rem 0.9rem",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    zIndex: 100,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  dialog: {
    width: "420px",
    maxWidth: "90vw",
    borderRadius: "12px",
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
    padding: "1.25rem 1.5rem",
  },
  dialogTitle: {
    fontSize: "1.05rem",
    fontWeight: 600,
    margin: "0 0 0.6rem 0",
  },
  dialogBody: {
    fontSize: "0.9rem",
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    margin: "0 0 1.1rem 0",
  },
  dialogActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.6rem",
  },
  cancelBtn: {
    padding: "0.45rem 1rem",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-primary)",
    fontSize: "0.85rem",
    cursor: "pointer",
  },
  confirmBtn: {
    padding: "0.45rem 1rem",
    borderRadius: "8px",
    border: "none",
    background: "var(--accent)",
    color: "#000",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  },
};
