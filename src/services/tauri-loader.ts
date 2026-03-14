/**
 * Custom hls.js Loader that uses window.fetch (intercepted by the
 * Tauri HTTP plugin) instead of XMLHttpRequest.
 *
 * In Tauri v2, the HTTP plugin overrides window.fetch to route requests
 * through Rust's reqwest — this bypasses WebView2 CORS restrictions.
 * However, XHR is NOT overridden, so hls.js's default XhrLoader fails.
 * This loader forces hls.js to use fetch instead of XHR.
 */

import type {
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderStats,
} from "hls.js";
import { LoadStats } from "hls.js";

/**
 * Factory that creates a FetchLoader class bound to a specific Plex token.
 */
export function createTauriLoaderClass(serverToken: string) {
  return class TauriFetchLoader implements Loader<LoaderContext> {
    public context: LoaderContext | null = null;
    public stats: LoaderStats = new LoadStats();

    private callbacks: LoaderCallbacks<LoaderContext> | null = null;
    private aborted = false;
    private abortController: AbortController | null = null;

    constructor(_config: object) {}

    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>,
    ): void {
      this.context = context;
      this.callbacks = callbacks;
      this.stats = new LoadStats();
      this.stats.loading.start = performance.now();
      this.aborted = false;

      // Add the Plex token if not already present
      let url = context.url;
      if (!url.includes("X-Plex-Token=")) {
        const separator = url.includes("?") ? "&" : "?";
        url = `${url}${separator}X-Plex-Token=${encodeURIComponent(serverToken)}`;
      }

      // Build request headers
      const headers: Record<string, string> = {};
      if (context.rangeStart !== undefined && context.rangeEnd !== undefined) {
        headers["Range"] = `bytes=${context.rangeStart}-${context.rangeEnd - 1}`;
      }

      const timeoutMs =
        config.loadPolicy?.maxLoadTimeMs ?? config.timeout ?? 30000;

      const timeoutId = setTimeout(() => {
        if (this.aborted) return;
        this.aborted = true;
        this.abortController?.abort();
        console.warn(`[HLS Loader] Timeout after ${timeoutMs}ms for ${url.substring(0, 80)}`);
        if (this.callbacks?.onTimeout) {
          this.callbacks.onTimeout(this.stats, context, null);
        }
      }, timeoutMs);

      this.abortController = new AbortController();

      const urlShort = url.split("/").pop()?.split("?")[0] ?? url.substring(0, 60);
      console.log(`[HLS Loader] Loading: ${urlShort} (type: ${context.responseType})`);

      window
        .fetch(url, {
          method: "GET",
          headers,
          signal: this.abortController.signal,
        })
        .then(async (response) => {
          clearTimeout(timeoutId);
          if (this.aborted) return;

          this.stats.loading.first = performance.now();

          if (!response.ok && response.status !== 206) {
            console.error(`[HLS Loader] HTTP ${response.status} for ${urlShort}`);
            if (this.callbacks) {
              this.callbacks.onError(
                { code: response.status, text: response.statusText },
                context,
                null,
                this.stats,
              );
            }
            return;
          }

          let data: string | ArrayBuffer;
          if (context.responseType === "arraybuffer") {
            const blob = await response.blob();
            data = await blob.arrayBuffer();
          } else {
            data = await response.text();
          }

          // Check if loader was destroyed during async body reading
          if (this.aborted || !this.callbacks) return;

          const byteLength =
            typeof data === "string" ? data.length : data.byteLength;
          this.stats.loaded = byteLength;
          this.stats.total = byteLength;
          this.stats.loading.end = performance.now();

          // Normalize 206 to 200 for hls.js compatibility
          const code = response.status === 206 ? 200 : response.status;

          this.callbacks.onSuccess(
            {
              url: response.url || context.url,
              data,
              code,
              text: response.statusText,
            },
            this.stats,
            context,
            null,
          );
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          if (this.aborted) return;

          if (this.callbacks) {
            this.callbacks.onError(
              {
                code: 0,
                text: err?.message ?? err?.toString?.() ?? "Fetch error",
              },
              context,
              null,
              this.stats,
            );
          }
        });
    }

    abort(): void {
      this.aborted = true;
      this.stats.aborted = true;
      this.abortController?.abort();
      // Only fire onAbort if callbacks are still set (not during destroy)
      if (this.callbacks?.onAbort) {
        this.callbacks.onAbort(this.stats, this.context!, null);
      }
    }

    destroy(): void {
      // Null callbacks FIRST to prevent recursive onAbort → resetLoader → destroy loop
      this.callbacks = null;
      this.aborted = true;
      this.stats.aborted = true;
      this.abortController?.abort();
      this.context = null;
      this.abortController = null;
    }

    getCacheAge(): number | null {
      return null;
    }

    getResponseHeader(_name: string): string | null {
      return null;
    }
  };
}
