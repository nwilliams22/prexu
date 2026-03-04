/**
 * Custom hls.js Loader that uses Tauri's native HTTP plugin.
 *
 * WebView2 enforces CORS on all XHR/fetch requests from the frontend
 * (origin: https://tauri.localhost). Plex servers don't reliably handle
 * CORS preflight (OPTIONS) requests, causing hls.js network errors.
 *
 * This loader routes all HLS requests (manifests, segments, keys) through
 * Tauri's Rust-side HTTP client, bypassing CORS entirely.
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type {
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderStats,
} from "hls.js";
import { LoadStats } from "hls.js";

/**
 * Factory that creates a TauriLoader class bound to a specific Plex token.
 * This is needed because hls.js expects a loader *class* (constructor),
 * not an instance, and we need to inject the token at construction time.
 */
export function createTauriLoaderClass(serverToken: string) {
  return class TauriLoader implements Loader<LoaderContext> {
    public context: LoaderContext | null = null;
    public stats: LoaderStats = new LoadStats();

    private callbacks: LoaderCallbacks<LoaderContext> | null = null;
    private controller: AbortController = new AbortController();
    private response: Response | null = null;

    // hls.js passes the HlsConfig to the constructor
    constructor(_config: object) {
      // no-op — config not needed for our loader
    }

    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>,
    ): void {
      this.context = context;
      this.callbacks = callbacks;
      this.stats = new LoadStats();
      this.stats.loading.start = performance.now();

      this.controller = new AbortController();

      // Build the URL with the Plex token
      const separator = context.url.includes("?") ? "&" : "?";
      const url = `${context.url}${separator}X-Plex-Token=${encodeURIComponent(serverToken)}`;

      // Build request headers
      const headers: Record<string, string> = {};
      if (context.rangeStart !== undefined && context.rangeEnd !== undefined) {
        headers["Range"] = `bytes=${context.rangeStart}-${context.rangeEnd - 1}`;
      }

      // Timeout: use loadPolicy if available, fall back to deprecated timeout
      const timeoutMs =
        config.loadPolicy?.maxLoadTimeMs ?? config.timeout ?? 10000;

      const timeoutId = setTimeout(() => {
        this.controller.abort();
        if (this.callbacks?.onTimeout) {
          this.callbacks.onTimeout(this.stats, context, null);
        }
      }, timeoutMs);

      tauriFetch(url, {
        signal: this.controller.signal,
        headers,
      })
        .then(async (response) => {
          clearTimeout(timeoutId);
          this.response = response;
          this.stats.loading.first = performance.now();

          if (!response.ok) {
            if (this.callbacks) {
              this.callbacks.onError(
                { code: response.status, text: response.statusText },
                context,
                response,
                this.stats,
              );
            }
            return;
          }

          // Parse the response based on expected type
          let data: string | ArrayBuffer;
          if (context.responseType === "arraybuffer") {
            data = await response.arrayBuffer();
          } else {
            data = await response.text();
          }

          // Update stats
          const byteLength =
            typeof data === "string" ? data.length : data.byteLength;
          this.stats.loaded = byteLength;
          this.stats.total = byteLength;
          this.stats.loading.end = performance.now();

          if (this.callbacks) {
            this.callbacks.onSuccess(
              {
                url: response.url || context.url,
                data,
                code: response.status,
                text: response.statusText,
              },
              this.stats,
              context,
              response,
            );
          }
        })
        .catch((err) => {
          clearTimeout(timeoutId);

          if (this.stats.aborted) return;

          // AbortError from our abort() call
          if (err?.name === "AbortError") {
            this.stats.aborted = true;
            if (this.callbacks?.onAbort) {
              this.callbacks.onAbort(this.stats, context, null);
            }
            return;
          }

          if (this.callbacks) {
            this.callbacks.onError(
              { code: 0, text: err?.message ?? "Network error" },
              context,
              null,
              this.stats,
            );
          }
        });
    }

    abort(): void {
      this.stats.aborted = true;
      this.controller.abort();
      if (this.callbacks?.onAbort) {
        this.callbacks.onAbort(this.stats, this.context!, null);
      }
    }

    destroy(): void {
      this.abort();
      this.callbacks = null;
      this.context = null;
      this.response = null;
    }

    getCacheAge(): number | null {
      if (!this.response) return null;
      const age = this.response.headers.get("age");
      return age ? parseFloat(age) : null;
    }

    getResponseHeader(name: string): string | null {
      return this.response?.headers.get(name) ?? null;
    }
  };
}
