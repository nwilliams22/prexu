import { useEffect, useRef, useState } from "react";

/** Serialize writes to one app-local value, retaining the last confirmed value for Revert. */
export function useDeviceSetting<T>(initial: T, load: () => Promise<T>, save: (value: T) => Promise<void>) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<"loading" | "load-error" | "ready" | "saving" | "saved" | "error">("loading");
  const confirmed = useRef(initial);
  const draft = useRef(initial);
  const queue = useRef(Promise.resolve());
  const revision = useRef(0);
  const mounted = useRef(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    mounted.current = true;
    let current = true;
    setStatus("loading");
    load().then((saved) => {
      if (!current) return;
      confirmed.current = saved; draft.current = saved; setValue(saved); setStatus("ready");
    }, () => { if (current) setStatus("load-error"); });
    return () => { current = false; mounted.current = false; };
  }, [load, attempt]);
  useEffect(() => {
    if (status !== "saved") return;
    const timer = setTimeout(() => setStatus("ready"), 2000);
    return () => clearTimeout(timer);
  }, [status]);
  function update(next: T) {
    draft.current = next;
    setValue(next);
    setStatus("saving");
    const version = ++revision.current;
    queue.current = queue.current.then(async () => {
      try {
        await save(next);
        confirmed.current = next;
        if (mounted.current && version === revision.current) setStatus("saved");
      } catch {
        if (mounted.current && version === revision.current) setStatus("error");
      }
    });
  }
  return { value, status, update, retry: () => update(draft.current),
    retryLoad: () => setAttempt((n) => n + 1),
    revert: () => { setValue(confirmed.current); draft.current = confirmed.current; setStatus("ready"); },
    disabled: status === "loading" || status === "load-error",
  };
}
