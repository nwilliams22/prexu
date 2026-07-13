import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { version } from "./package.json";

const host = process.env.TAURI_DEV_HOST;

/**
 * "player-chrome-test" is a dedicated Vite mode — never the default
 * "development"/"production" modes used by `npm run dev` / `npm run build`
 * — that swaps the playback engine hook for a scriptable no-op stub so
 * Playwright can drive the real player chrome (src/components/player/) on
 * /play/<ratingKey> without a native player or a real Plex stream (prexu-
 * ceiz, spike prexu-pd1x.12).
 *
 * The alias below is the ONLY thing gated on this mode. It must never leak
 * into `npm run dev` (mode "development") or `npm run build` (mode
 * "production") — see src/hooks/usePlayer.playwright-stub.ts's own
 * mode-guard for a second, independent check, and
 * e2e/player-chrome.spec.ts / the CI "verify stub absent" step for the
 * mechanical proof.
 */
const PLAYER_CHROME_TEST_MODE = "player-chrome-test";

export default defineConfig(async ({ mode }) => ({
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", {}]],
      },
    }),
  ],

  define: {
    __APP_VERSION__: JSON.stringify(version),
  },

  resolve: {
    alias:
      mode === PLAYER_CHROME_TEST_MODE
        ? [
            {
              // Matches the sole value-level import site
              // (src/pages/Player.tsx: `import { usePlayer } from
              // "../hooks/usePlayer"`) regardless of relative depth, but
              // nothing else. Anchored at BOTH ends (^...$) — Vite's alias
              // plugin does `importee.replace(find, replacement)`, and
              // String.replace with a RegExp only swaps the matched
              // SUBSTRING, not the whole specifier. A one-sided anchor
              // (e.g. just `$`) would leave the un-matched relative prefix
              // (like "../") glued onto the absolute replacement path,
              // producing a bogus id such as "../<absolute-path>" that
              // fails to resolve. Full-string anchoring guarantees the
              // match spans the entire specifier so the swap is clean.
              find: /^(\.\.?\/)+hooks\/usePlayer$/,
              replacement: fileURLToPath(
                new URL("./src/hooks/usePlayer.playwright-stub.ts", import.meta.url),
              ),
            },
          ]
        : [],
  },

  // Prevent vite from obscuring Rust errors
  clearScreen: false,

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-tauri": ["@tauri-apps/api", "@tauri-apps/plugin-shell"],
        },
      },
    },
    chunkSizeWarningLimit: 300,
  },

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
