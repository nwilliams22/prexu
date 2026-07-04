/**
 * Custom hls.js Loader that uses Tauri's HTTP plugin instead of XHR or
 * window.fetch.
 *
 * Routing through @tauri-apps/plugin-http sends requests from Rust's reqwest
 * instead of WebView2 — that strips the browser-injected Origin, Referer,
 * and Sec-Fetch-* headers which Plex's embedded HTTP server rejects with
 * a bare HTML "400 Bad Request" on the /video/:/transcode endpoint.
 */

import type {
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderStats,
} from "hls.js";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { logger, redactUrl } from "./logger";

/**
 * Zeroed LoaderStats, replacing hls.js's `LoadStats` class (prexu-0szx.1).
 *
 * This module must import hls.js as TYPES ONLY: a single runtime import here
 * puts hls.js (~542 KB min) into the static graph, and because
 * useHlsLoader.ts dynamic-imports it too, Rollup hoists the whole library
 * into whatever chunk this file lands in (it was 80% of the lazy Player
 * chunk — parsed on every player open, native-mpv path included, which
 * never runs hls.js). Vite warns on the regression at build time:
 * "hls.mjs is dynamically imported ... but also statically imported".
 */
function makeLoaderStats(): LoaderStats {
  return {
    aborted: false,
    loaded: 0,
    retry: 0,
    total: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: 0, first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 },
  };
}

/**
 * Factory that creates a FetchLoader class bound to a specific Plex token.
 */
export function createTauriLoaderClass(serverToken: string) {
  return class TauriFetchLoader implements Loader<LoaderContext> {
    public context: LoaderContext | null = null;
    public stats: LoaderStats = makeLoaderStats();

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
      this.stats = makeLoaderStats();
      this.stats.loading.start = performance.now();
      this.aborted = false;

      const url = context.url;

      // Build request headers. Token is sent via header only — not appended
      // to the URL — so it does not appear in Tauri's structured log output or
      // in the HLS segment URL that hls.js surfaces in error events.
      const headers: Record<string, string> = {
        "X-Plex-Token": serverToken,
      };
      if (context.rangeStart !== undefined && context.rangeEnd !== undefined) {
        headers["Range"] = `bytes=${context.rangeStart}-${context.rangeEnd - 1}`;
      }

      const timeoutMs =
        config.loadPolicy?.maxLoadTimeMs ?? config.timeout ?? 30000;

      const timeoutId = setTimeout(() => {
        if (this.aborted) return;
        this.aborted = true;
        this.abortController?.abort();
        void logger.warn("tauri", `timeout after ${timeoutMs}ms for ${redactUrl(url)}`);
        if (this.callbacks?.onTimeout) {
          this.callbacks.onTimeout(this.stats, context, null);
        }
      }, timeoutMs);

      this.abortController = new AbortController();

      const urlShort = url.split("/").pop()?.split("?")[0] ?? url.substring(0, 60);
      void logger.debug("tauri", `loading: ${urlShort} (type: ${context.responseType})`);

      tauriFetch(url, {
        method: "GET",
        headers,
        signal: this.abortController.signal,
      })
        .then(async (response) => {
          clearTimeout(timeoutId);
          if (this.aborted) return;

          this.stats.loading.first = performance.now();

          if (!response.ok && response.status !== 206) {
            void logger.error("tauri", `http ${response.status} for ${urlShort}`);
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
            data = await response.arrayBuffer();
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
