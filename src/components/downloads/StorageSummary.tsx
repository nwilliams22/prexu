import { useEffect, useState } from "react";
import { getDownloadStorage, type DownloadStorage } from "../../services/downloads";
import { formatBytes } from "./format";

export default function StorageSummary() {
  const [storage, setStorage] = useState<DownloadStorage | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const next = await getDownloadStorage();
        if (!disposed) { setStorage(next); setUnavailable(false); }
      } catch {
        if (!disposed) setUnavailable(true);
      }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5000);
    window.addEventListener("focus", refresh);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  return <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: 16 }}>
    {unavailable ? "Download storage unavailable" : storage
      ? `${formatBytes(storage.usedBytes)} used by downloads · ${formatBytes(storage.freeBytes)} free on download drive`
      : "Checking download storage…"}
  </p>;
}
