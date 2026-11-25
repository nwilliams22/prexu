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
    const trigger = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onCancel={onCancel} style={{
      background: "var(--bg-secondary)", color: "var(--text-primary)",
      border: "1px solid var(--border)", borderRadius: 12, padding: "1.5rem",
      margin: "auto", width: "min(480px, calc(100vw - 2rem))", maxHeight: "90vh", overflowY: "auto",
    }}>
      <h3 id={titleId} style={{ marginBottom: 12 }}>Delete {items.length} downloaded {items.length === 1 ? "item" : "items"}?</h3>
      <p style={{ marginBottom: 16 }}>This removes the local files. You can download them again from your server.</p>
      <ul style={{ maxHeight: "40vh", overflowY: "auto", marginBottom: 20, paddingLeft: 20, listStyle: "disc" }}>
        {items.map((item) => <li key={item.ratingKey}>{item.title} {item.subtitle}</li>)}
      </ul>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
        <button style={buttonStyle} onClick={onCancel}>Cancel</button>
        <button style={{ ...buttonStyle, background: "var(--accent)", color: "#000" }} onClick={onConfirm}>Delete downloads</button>
      </div>
    </dialog>
  );
}

const buttonStyle: React.CSSProperties = {
  border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem 0.75rem",
  background: "transparent", color: "var(--text-primary)", cursor: "pointer",
};
