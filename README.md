# Prexu

A custom cross-platform Plex desktop client built with React 19 + TypeScript +
Tauri v2 (Rust). Prexu adds a native libmpv-backed video player on Windows for
broad codec support (notably HEVC 10-bit, which WebView2/Chromium cannot decode
in real time without a paid Store codec).

## Tech stack

- **Frontend:** React 19 + TypeScript, Vite
- **Desktop shell:** Tauri v2 (Rust)
- **Native player (Windows):** libmpv via DirectComposition + D3D11/ANGLE
- **Relay server:** Rust + Axum (WebSocket relay for Watch Together)
- **Testing:** Vitest + React Testing Library (unit), Playwright (E2E)

## Platform support

| Platform | Status | Player engine |
|----------|--------|---------------|
| **Windows** | Supported | Native libmpv (HEVC 10-bit, broad codecs) |
| **macOS** | Builds; native player deferred | HTML5 `<video>` + hls.js |
| **Linux** | Builds; native player deferred | HTML5 `<video>` + hls.js |

The native player is Windows-only by design. Porting it to macOS/Linux is a
render-API project, not a simple port — see
[`docs/adr-native-player-cross-platform.md`](docs/adr-native-player-cross-platform.md)
for the analysis. Linux parity is the next planned platform target.

## Known limitations

- **IME / composition input under the native player is untested.** The Windows
  native player composites the React UI over the video via DirectComposition
  visual hosting. Input is forwarded through a window subclass
  (`src-tauri/src/player/composition_host.rs`). Standard Latin keyboard input is
  exercised, but **IME / dead-key / composition input (e.g. CJK, accented
  characters) has not been verified** under composition hosting. It is expected
  to work in theory because input events are forwarded to the hosted WebView2,
  but this path has not been tested on hardware. Tracked as `prexu-x2bt`.

## Development

```bash
npm run dev            # Vite dev server (browser, HTML5 player)
npm run tauri dev      # Full Tauri desktop app (native player on Windows)
npx vitest run         # Unit tests
npx tsc --noEmit       # Type check
cd relay-server && cargo check   # Relay server check
```

## Project structure

- `src/` — React frontend (components, hooks, pages, services, types)
- `src-tauri/` — Tauri desktop shell (Rust); `src-tauri/src/player/` holds the
  Windows native-player implementation
- `relay-server/` — Watch Together relay server (Rust/Axum)
- `e2e/` — Playwright E2E tests
- `docs/` — architecture decision records and implementation status
