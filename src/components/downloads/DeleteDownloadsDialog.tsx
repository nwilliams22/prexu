import { useEffect, useRef, useId } from "react";
import type { DownloadItem } from "../../types/downloads";

export default function DeleteDownloadsDialog({ items, onCancel, onConfirm }: {
  items: DownloadItem[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onCancel={onCancel} style={{
      background: "var(--bg-secondary)", color: "var(--text-primary)",
      border: "1px solid var(--border)", borderRadius: 12, padding: "1.5rem", maxWidth: 480,
    }}>
      <h3 id={titleId}>Delete {items.length} downloaded {items.length === 1 ? "item" : "items"}?</h3>
      <p>This removes the local files. You can download them again from your server.</p>
      <ul style={{ maxHeight: "40vh", overflowY: "auto" }}>
        {items.map((item) => <li key={item.ratingKey}>{item.title} {item.subtitle}</li>)}
      </ul>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
        <button autoFocus onClick={onCancel}>Cancel</button>
        <button onClick={onConfirm}>Delete downloads</button>
      </div>
    </dialog>
  );
}
