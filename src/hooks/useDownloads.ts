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

// Serialized on purpose: the Plex server drops the in-flight file stream
// with IncompleteBody the moment a second full-file GET starts (observed
// consistently on LAN — two concurrent downloads kill each other in turns).
const MAX_CONCURRENT = 1;
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
  // Bumped when a retry backoff elapses so the queue effect re-runs;
  // ref mutations alone don't re-render.
  const [retryTick, setRetryTick] = useState(0);
  const processingRef = useRef(new Set<string>());
  const autoRetriesRef = useRef(new Map<string, number>());
  const retryTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const serverRef = useRef(server);
  serverRef.current = server;
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
      // Mark any "downloading" items from a previous session as errored
      const restored = saved.map((item) =>
        item.status === "downloading"
          ? { ...item, status: "error" as const, errorMessage: "Interrupted" }
          : item,
      );
      setDownloads(restored);
    });
  }, []);

  // Persist downloads to storage when membership or status changes.
  // Progress events mutate bytesDownloaded many times per second — writing
  // storage on every tick is wasted I/O, and interrupted "downloading" items
  // are reset on restart anyway, so byte counts only matter at completion.
  const persistSigRef = useRef("");
  useEffect(() => {
    const sig = downloads.map((d) => `${d.ratingKey}:${d.status}`).join("|");
    if (sig === persistSigRef.current) return;
    persistSigRef.current = sig;
    saveDownloadItems(downloads);
  }, [downloads]);

  // Listen for Tauri download-progress events
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<DownloadProgressEvent>(
        "download-progress",
        (event) => {
          const { ratingKey, bytesDownloaded, status, errorMessage } =
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
                status: status as DownloadItem["status"],
                errorMessage: errorMessage ?? item.errorMessage,
                completedAt:
                  status === "complete" ? Date.now() : item.completedAt,
              };
            }),
          );

          // When a download finishes, remove from processing so queue picks up next
          if (
            status === "complete" ||
            status === "error" ||
            status === "cancelled"
          ) {
            processingRef.current.delete(ratingKey);
          }
          if (status === "complete") {
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
    })();

    return () => {
      unlisten?.();
    };
  }, []);

  // Queue processor — start downloads when slots are available
  useEffect(() => {
    if (!server) return;

    const activeCount = downloads.filter(
      (d) => d.status === "downloading",
    ).length;
    const queued = downloads.filter(
      (d) => d.status === "queued" && !processingRef.current.has(d.ratingKey),
    );

    const slotsAvailable = MAX_CONCURRENT - activeCount;
    if (slotsAvailable <= 0 || queued.length === 0) return;

    const toStart = queued.slice(0, slotsAvailable);
    for (const item of toStart) {
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
        const message = err instanceof Error ? err.message : String(err);
        const attempts = autoRetriesRef.current.get(item.ratingKey) ?? 0;
        // Transient stream errors (connection reset, bad response body) are
        // common; requeue with backoff before surfacing a failure. The key
        // stays in processingRef during the backoff so the queue effect
        // leaves it alone until the timer releases it.
        if (attempts < MAX_AUTO_RETRIES) {
          autoRetriesRef.current.set(item.ratingKey, attempts + 1);
          // The "error" progress event may have already removed the key from
          // processingRef — re-add it so the queue can't restart this item
          // before the backoff elapses.
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
                    bytesDownloaded: 0,
                    errorMessage: undefined,
                  }
                : d,
            ),
          );
          const timer = setTimeout(() => {
            retryTimersRef.current.delete(timer);
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
      });
    }
    // retryTick re-runs this effect when a retry backoff elapses.
  }, [downloads, server, retryTick]);

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
      return [...prev, { ...item, status: "queued", bytesDownloaded: 0 }];
    });
  }, []);

  const cancelDownloadFn = useCallback((ratingKey: string) => {
    cancelDownloadService(ratingKey).catch(() => {});
    setDownloads((prev) =>
      prev.map((d) =>
        d.ratingKey === ratingKey
          ? { ...d, status: "cancelled" as const }
          : d,
      ),
    );
    processingRef.current.delete(ratingKey);
  }, []);

  const deleteDownloadFn = useCallback((ratingKey: string) => {
    deleteDownloadService(ratingKey).catch(() => {});
    setDownloads((prev) => prev.filter((d) => d.ratingKey !== ratingKey));
    processingRef.current.delete(ratingKey);
  }, []);

  const retryDownload = useCallback((ratingKey: string) => {
    autoRetriesRef.current.delete(ratingKey);
    setDownloads((prev) =>
      prev.map((d) =>
        d.ratingKey === ratingKey
          ? { ...d, status: "queued" as const, bytesDownloaded: 0, errorMessage: undefined }
          : d,
      ),
    );
  }, []);

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
    ],
  );
}
