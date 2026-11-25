import { useDownloads } from "../../hooks/useDownloads";
import { formatBytes, formatSpeed, formatTimeLeft } from "./format";
import "./queue.css";

export default function DownloadQueue() {
  const { downloads, pauseDownload, resumeDownload, pauseAll, resumeAll,
    reorderDownloads, cancelDownload, bytesPerSecond, etaSeconds } = useDownloads();
  const queue = downloads.filter((item) => ["downloading", "queued", "paused"].includes(item.status));
  if (!queue.length) return null;
  const running = queue.some((item) => item.status !== "paused");
  const paused = queue.some((item) => item.status === "paused");

  function move(index: number, direction: -1 | 1) {
    const keys = queue.map((item) => item.ratingKey);
    const target = index + direction;
    if (target < 0 || target >= keys.length) return;
    const current = keys[index];
    const neighbour = keys[target];
    if (current === undefined || neighbour === undefined) return;
    keys[index] = neighbour;
    keys[target] = current;
    reorderDownloads(keys);
  }

  return (
    <section className="download-queue" aria-labelledby="download-queue-title">
      <div className="download-queue-header">
        <h3 id="download-queue-title">Download queue ({queue.length})</h3>
        <div className="download-queue-actions">
          <button disabled={!running} onClick={pauseAll}>Pause all</button>
          <button disabled={!paused} onClick={resumeAll}>Resume all</button>
        </div>
      </div>
      <p className="download-queue-meta">
        {running ? `${formatSpeed(bytesPerSecond)} overall · ${formatTimeLeft(etaSeconds)}${paused ? " (excludes paused items)" : ""}` : "All downloads paused"}
      </p>
      <p className="download-queue-meta">Queue order applies when a download slot becomes available.</p>
      <ol className="download-queue-list">
        {queue.map((item, index) => {
          const progress = item.fileSize > 0 ? Math.min(100, Math.max(0, item.bytesDownloaded / item.fileSize * 100)) : undefined;
          return (
            <li key={item.ratingKey} className="download-queue-item" aria-label={`${item.title} ${item.subtitle}`}>
              <div className="download-queue-info">
                <strong>{item.title}</strong>
                <span className="download-queue-meta">{[item.grandparentTitle, item.subtitle].filter(Boolean).join(" — ")}</span>
                <span className="download-queue-meta">{item.status === "paused" ? "Paused" : item.status === "queued" ? "Waiting" : "Downloading"} · {formatBytes(item.bytesDownloaded)} / {item.fileSize > 0 ? formatBytes(item.fileSize) : "Unknown size"}</span>
                {item.status === "downloading" && <span className="download-queue-meta">{formatSpeed(item.bytesPerSecond)} · {formatTimeLeft(item.etaSeconds)}</span>}
                {item.statusMessage && <span className="download-queue-meta">{item.statusMessage}</span>}
                <progress aria-label={`Download progress for ${item.title}`} max={100} value={progress} />
              </div>
              <div className="download-queue-actions">
                {item.status === "paused"
                  ? <button aria-label={`Resume ${item.title}`} onClick={() => resumeDownload(item.ratingKey)}>Resume</button>
                  : <button aria-label={`Pause ${item.title}`} onClick={() => pauseDownload(item.ratingKey)}>Pause</button>}
                <button aria-label={`Move ${item.title} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                <button aria-label={`Move ${item.title} down`} disabled={index === queue.length - 1} onClick={() => move(index, 1)}>↓</button>
                <button aria-label={`Cancel ${item.title}`} onClick={() => cancelDownload(item.ratingKey)}>Cancel</button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
