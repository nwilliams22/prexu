export function DeviceSaveStatus({ status, retry, revert }: { status: string; retry: () => void; revert: () => void }) {
  return <div role="status" className="preference-save-status">
    {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? <>Not saved <button onClick={retry}>Retry</button><button onClick={revert}>Revert</button></> : null}
  </div>;
}
