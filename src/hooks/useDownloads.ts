import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import {
  startDownload,
  controlDownloadQueue,
  cancelDownload as cancelDownloadService,
  deleteDownload as deleteDownloadService,
} from "../services/downloads";
import { getDownloadItems, saveDownloadItems } from "../services/storage";
import { logger } from "../services/logger";
import type { DownloadItem, DownloadProgressEvent } from "../types/downloads";
import type { ToastVariant } from "../types/toast";

/**
 * Matches `ToastContextValue["toast"]` (src/hooks/useToast.ts) without
 * importing the whole context module. `useDownloadsState` is invoked
 * directly inside AppProviders' function body, BEFORE the JSX tree that
 * renders `<ToastProvider>` — calling `useToast()` from in here would look
 * up a ToastContext ancestor that doesn't exist yet at that call site, so
 * the dispatcher is threaded in as a parameter instead (AppProviders
 * already has `toastState.toast` in scope at the point it calls this hook).
 */
export type DownloadToastFn = (
  message: string,
  variant?: ToastVariant,
  duration?: number,
) => void;

const noopToast: DownloadToastFn = () => {};

const MAX_AUTO_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 3000, 8000];

export interface DownloadsContextValue {
  downloads: DownloadItem[];
  isDownloaded: (ratingKey: string) => boolean;
  isDownloading: (ratingKey: string) => boolean;
  getDownload: (ratingKey: string) => DownloadItem | undefined;
  queueDownload: (item: DownloadItem) => void;
  cancelDownload: (ratingKey: string) => void;
  deleteDownload: (ratingKey: string) => void;
  retryDownload: (ratingKey: string) => void;
  pauseDownload: (ratingKey: string) => void;
  resumeDownload: (ratingKey: string) => void;
  pauseAll: () => void;
  resumeAll: () => void;
  reorderDownloads: (ratingKeys: string[]) => void;
  concurrency: number;
  setConcurrency: (limit: number) => void;
  bytesPerSecond: number;
  etaSeconds: number | null;
}

const DownloadsContext = createContext<DownloadsContextValue | null>(null);

export const DownloadsProvider = DownloadsContext.Provider;

export function useDownloads(): DownloadsContextValue {
  const ctx = useContext(DownloadsContext);
  if (!ctx) {
    throw new Error("useDownloads must be used within DownloadsProvider");
  }
  return ctx;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function useDownloadsState(
  server: { uri: string; accessToken: string } | null,
  toast: DownloadToastFn = noopToast,
): DownloadsContextValue {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [concurrency, setConcurrencyState] = useState(() => {
    const saved = Number(localStorage.getItem("prexu.downloadConcurrency"));
    return Number.isInteger(saved) && saved >= 1 && saved <= 3 ? saved : 1;
  });
  const [loaded, setLoaded] = useState(false);
  const intentRef = useRef(new Map<string, "paused" | "cancelled" | "queued">());
  const allPausedRef = useRef(false);
  const backoffRef = useRef(new Set<string>());
  const control = useCallback((action: Parameters<typeof controlDownloadQueue>[0], options?: Parameters<typeof controlDownloadQueue>[1]) => {
    return controlDownloadQueue(action, options).catch((error: unknown) => {
      logger.error("downloads", "queue control failed", { error: String(error) });
      toastRef.current("Download queue control failed", "error");
      throw error;
    });
  }, []);
  useEffect(() => {
    if (isTauriRuntime()) void control("limit", { limit: concurrency }).catch(() => {});
  }, [concurrency, control]);
  // Bumped when a retry backoff elapses so the queue effect re-runs;
  // ref mutations alone don't re-render.
  const [retryTick, setRetryTick] = useState(0);
  const processingRef = useRef(new Set<string>());
  const autoRetriesRef = useRef(new Map<string, number>());
  const retryTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  // Mirrors `downloads` for the progress-event listener below, whose effect
  // has an empty dep array (it subscribes once) — reading `downloads`
  // directly there would close over a stale, empty array on first mount.
  const downloadsRef = useRef(downloads);
  downloadsRef.current = downloads;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    const timers = retryTimersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  // Load saved download metadata on mount
  useEffect(() => {
    getDownloadItems().then((saved) => {
      // The native engine uses the actual .part length when this item resumes.
      const restored = saved.map((item) =>
        item.status === "downloading"
          ? { ...item, status: "paused" as const, bytesPerSecond: 0, etaSeconds: null, errorMessage: undefined }
          : item,
      );
      setDownloads(restored);
      setLoaded(true);
    });
  }, []);

  // Persist downloads to storage when membership or status changes.
  // Progress events mutate bytesDownloaded many times per second — writing
  // storage on every tick is wasted I/O. Native resume reads the real .part
  // length; saved byte counts are only a display hint after restart.
  const persistSigRef = useRef("");
  useEffect(() => {
    if (!loaded) return;
    const sig = downloads.map((d) => `${d.ratingKey}:${d.status}`).join("|");
    if (sig === persistSigRef.current) return;
    persistSigRef.current = sig;
    saveDownloadItems(downloads);
  }, [downloads, loaded]);

  // Listen for Tauri download-progress events
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<DownloadProgressEvent>(
        "download-progress",
        (event) => {
          const { ratingKey, bytesDownloaded, status, errorMessage, totalBytes, bytesPerSecond, etaSeconds, statusMessage } =
            event.payload;

          // Looked up before setDownloads so the toast has the item's title
          // even though the state update below is what actually applies the
          // new status — reading from the ref (not the `downloads` state
          // this effect closed over on mount) keeps it current.
          const title =
            downloadsRef.current.find((d) => d.ratingKey === ratingKey)
              ?.title ?? "Download";

          setDownloads((prev) =>
            prev.map((item) => {
              if (item.ratingKey !== ratingKey) return item;
              return {
                ...item,
                bytesDownloaded,
                status: intentRef.current.get(ratingKey) ?? status as DownloadItem["status"],
                fileSize: totalBytes || item.fileSize,
                bytesPerSecond: intentRef.current.has(ratingKey) ? 0 : bytesPerSecond ?? 0,
                etaSeconds: intentRef.current.has(ratingKey) ? null : etaSeconds ?? null,
                statusMessage,
                errorMessage: errorMessage ?? item.errorMessage,
                completedAt:
                  status === "complete" ? Date.now() : item.completedAt,
              };
            }),
          );

          if (status === "complete" && !intentRef.current.has(ratingKey)) {
            autoRetriesRef.current.delete(ratingKey);
            logger.info("downloads", "download complete", { ratingKey, title });
            toastRef.current(`"${title}" downloaded`, "success");
          }
          // Note: a "error" status here may still be auto-retried by the
          // queue-processor effect below — the failure toast fires only
          // once retries are exhausted (see that effect's catch handler).
          // "cancelled" never toasts — it's always user-initiated.
        },
      );
      if (disposed) unlisten();
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Queue processor — start downloads when slots are available
  useEffect(() => {
    if (!server || !loaded || allPausedRef.current) return;

    const activeCount = [...processingRef.current].filter((key) => !backoffRef.current.has(key)).length;
    const queued = downloads.filter(
      (d) => d.status === "queued" && !processingRef.current.has(d.ratingKey),
    );

    const slotsAvailable = concurrency - activeCount;
    if (slotsAvailable <= 0 || queued.length === 0) return;

    const toStart = queued.slice(0, slotsAvailable);
    for (const item of toStart) {
      intentRef.current.delete(item.ratingKey);
      processingRef.current.add(item.ratingKey);

      setDownloads((prev) =>
        prev.map((d) =>
          d.ratingKey === item.ratingKey
            ? { ...d, status: "downloading" as const }
            : d,
        ),
      );

      logger.info("downloads", "starting download", {
        ratingKey: item.ratingKey,
        fileName: item.fileName,
      });
      startDownload(
        item.serverUri,
        server.accessToken,
        item.ratingKey,
        item.partKey,
        item.fileName,
        item.fileSize,
      ).catch((err) => {
        if (intentRef.current.has(item.ratingKey) || !downloadsRef.current.some((d) => d.ratingKey === item.ratingKey)) return;
        const message = err instanceof Error ? err.message : String(err);
        const attempts = autoRetriesRef.current.get(item.ratingKey) ?? 0;
        // Transient stream errors (connection reset, bad response body) are
        // common; requeue with backoff before surfacing a failure. The key
        // stays in processingRef during the backoff so the queue effect
        // leaves it alone until the timer releases it.
        if (attempts < MAX_AUTO_RETRIES) {
          autoRetriesRef.current.set(item.ratingKey, attempts + 1);
          backoffRef.current.add(item.ratingKey);
          // Keep this key reserved until its backoff expires.
          processingRef.current.add(item.ratingKey);
          const delay =
            RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length - 1)];
          logger.warn("downloads", "download failed — auto-retrying", {
            ratingKey: item.ratingKey,
            attempt: attempts + 1,
            delayMs: delay,
            error: message,
          });
          setDownloads((prev) =>
            prev.map((d) =>
              d.ratingKey === item.ratingKey
                ? {
                    ...d,
                    status: "queued" as const,
                    bytesPerSecond: 0,
                    etaSeconds: null,
                    errorMessage: undefined,
                  }
                : d,
            ),
          );
          const timer = setTimeout(() => {
            retryTimersRef.current.delete(timer);
            backoffRef.current.delete(item.ratingKey);
            processingRef.current.delete(item.ratingKey);
            setRetryTick((t) => t + 1);
          }, delay);
          retryTimersRef.current.add(timer);
          return;
        }
        processingRef.current.delete(item.ratingKey);
        logger.error("downloads", "download failed", {
          ratingKey: item.ratingKey,
          error: message,
        });
        setDownloads((prev) =>
          prev.map((d) =>
            d.ratingKey === item.ratingKey
              ? {
                  ...d,
                  status: "error" as const,
                  errorMessage: message,
                }
              : d,
          ),
        );
        // Auto-retries exhausted — this is the one point that knows the
        // failure is final rather than a transient error about to be
        // retried, so the toast fires here rather than off the raw
        // "error" progress-event status.
        toastRef.current(`"${item.title}" download failed`, "error");
      }).finally(() => {
        if (!backoffRef.current.has(item.ratingKey)) processingRef.current.delete(item.ratingKey);
        setRetryTick((tick) => tick + 1);
      });
    }
    // retryTick re-runs this effect when a retry backoff elapses.
  }, [downloads, server, retryTick, concurrency, loaded]);

  const isDownloaded = useCallback(
    (ratingKey: string) =>
      downloads.some(
        (d) => d.ratingKey === ratingKey && d.status === "complete",
      ),
    [downloads],
  );

  const isDownloading = useCallback(
    (ratingKey: string) =>
      downloads.some(
        (d) =>
          d.ratingKey === ratingKey &&
          (d.status === "downloading" || d.status === "queued"),
      ),
    [downloads],
  );

  const getDownload = useCallback(
    (ratingKey: string) => downloads.find((d) => d.ratingKey === ratingKey),
    [downloads],
  );

  const queueDownload = useCallback((item: DownloadItem) => {
    autoRetriesRef.current.delete(item.ratingKey);
    setDownloads((prev) => {
      // Don't add duplicates
      if (prev.some((d) => d.ratingKey === item.ratingKey)) return prev;
      return [...prev, { ...item, status: allPausedRef.current ? "paused" : "queued", bytesDownloaded: 0 }];
    });
  }, []);

  const cancelDownloadFn = useCallback((ratingKey: string) => {
    intentRef.current.set(ratingKey, "cancelled");
    cancelDownloadService(ratingKey).catch(() => {});
    setDownloads((prev) =>
      prev.map((d) =>
        d.ratingKey === ratingKey
          ? { ...d, status: "cancelled" as const }
          : d,
      ),
    );
  }, []);

  const deleteDownloadFn = useCallback((ratingKey: string) => {
    intentRef.current.set(ratingKey, "cancelled");
    deleteDownloadService(ratingKey).catch(() => {});
    setDownloads((prev) => prev.filter((d) => d.ratingKey !== ratingKey));
  }, []);

  const retryDownload = useCallback((ratingKey: string) => {
    intentRef.current.set(ratingKey, "queued");
    autoRetriesRef.current.delete(ratingKey);
    setDownloads((prev) =>
      prev.map((d) =>
        d.ratingKey === ratingKey
          ? { ...d, status: "queued" as const, bytesPerSecond: 0, etaSeconds: null, errorMessage: undefined }
          : d,
      ),
    );
  }, []);

  const pauseDownload = useCallback((ratingKey: string) => {
    intentRef.current.set(ratingKey, "paused");
    setDownloads((items) => items.map((d) => d.ratingKey === ratingKey ? { ...d, status: "paused", bytesPerSecond: 0, etaSeconds: null } : d));
    void control("pause", { ratingKey }).catch(() => {});
  }, [control]);
  const resumeDownload = useCallback((ratingKey: string) => {
    void control("resumeAll").then(() => {
      allPausedRef.current = false;
      retryDownload(ratingKey);
    }).catch(() => {});
  }, [control, retryDownload]);
  const pauseAll = useCallback(() => {
    allPausedRef.current = true;
    setDownloads((items) => items.map((d) => {
      if (d.status !== "queued" && d.status !== "downloading") return d;
      intentRef.current.set(d.ratingKey, "paused");
      return { ...d, status: "paused", bytesPerSecond: 0, etaSeconds: null };
    }));
    void control("pauseAll").catch(() => {});
  }, [control]);
  const resumeAll = useCallback(() => {
    void control("resumeAll").then(() => {
      allPausedRef.current = false;
      setDownloads((items) => items.map((d) => {
        if (d.status !== "paused") return d;
        intentRef.current.set(d.ratingKey, "queued");
        return { ...d, status: "queued", errorMessage: undefined };
      }));
    }).catch(() => {});
  }, [control]);
  const reorderDownloads = useCallback((keys: string[]) => {
    setDownloads((items) => {
      const unique = [...new Set(keys)];
      return [...unique.flatMap((key) => items.filter((d) => d.ratingKey === key)), ...items.filter((d) => !unique.includes(d.ratingKey))];
    });
    void control("reorder", { order: keys }).catch(() => {});
  }, [control]);
  const setConcurrency = useCallback((limit: number) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 3) return;
    localStorage.setItem("prexu.downloadConcurrency", String(limit));
    setConcurrencyState(limit);
  }, []);
  const bytesPerSecond = downloads.reduce((sum, d) => sum + (d.status === "downloading" ? d.bytesPerSecond ?? 0 : 0), 0);
  const pending = downloads.filter((d) => d.status === "queued" || d.status === "downloading");
  const etaSeconds = bytesPerSecond > 0 && pending.every((d) => d.fileSize > 0)
    ? Math.ceil(pending.reduce((sum, d) => sum + Math.max(0, d.fileSize - d.bytesDownloaded), 0) / bytesPerSecond) : null;

  return useMemo(
    () => ({
      downloads,
      isDownloaded,
      isDownloading,
      getDownload,
      queueDownload,
      cancelDownload: cancelDownloadFn,
      deleteDownload: deleteDownloadFn,
      retryDownload,
      pauseDownload, resumeDownload, pauseAll, resumeAll, reorderDownloads, concurrency, setConcurrency, bytesPerSecond, etaSeconds,
    }),
    [
      downloads,
      isDownloaded,
      isDownloading,
      getDownload,
      queueDownload,
      cancelDownloadFn,
      deleteDownloadFn,
      retryDownload,
      pauseDownload, resumeDownload, pauseAll, resumeAll, reorderDownloads, concurrency, setConcurrency, bytesPerSecond, etaSeconds,
    ],
  );
}
