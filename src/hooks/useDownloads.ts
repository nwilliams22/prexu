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
import type { DownloadItem, DownloadProgressEvent } from "../types/downloads";

const MAX_CONCURRENT = 2;

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
): DownloadsContextValue {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const processingRef = useRef(new Set<string>());
  const serverRef = useRef(server);
  serverRef.current = server;

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

  // Persist downloads to storage on change
  const downloadsRef = useRef(downloads);
  downloadsRef.current = downloads;
  useEffect(() => {
    if (downloads.length > 0 || downloadsRef.current.length > 0) {
      saveDownloadItems(downloads);
    }
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

      startDownload(
        item.serverUri,
        server.accessToken,
        item.ratingKey,
        item.partKey,
        item.fileName,
        item.fileSize,
      ).catch((err) => {
        setDownloads((prev) =>
          prev.map((d) =>
            d.ratingKey === item.ratingKey
              ? {
                  ...d,
                  status: "error" as const,
                  errorMessage: err instanceof Error ? err.message : String(err),
                }
              : d,
          ),
        );
        processingRef.current.delete(item.ratingKey);
      });
    }
  }, [downloads, server]);

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
