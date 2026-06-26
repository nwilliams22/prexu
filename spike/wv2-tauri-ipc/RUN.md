# wv2-tauri-ipc spike — RUN & WHAT-TO-LOOK-FOR

THROWAWAY feasibility spike for **beads prexu-60mz.1 / Path C3a** — the GATE for
the C3 fork-vs-bypass decision.

> Does Tauri's IPC mechanism still work when the WebView2 is hosted in **VISUAL**
> mode (`CreateCoreWebView2CompositionController` + `SetRootVisualTarget`)
> instead of **windowed** mode?

Tauri's invoke/emit bridge rides entirely on the `ICoreWebView2` core object:
`AddScriptToExecuteOnDocumentCreated` (bootstrap inject), `add_WebMessageReceived`
(JS `window.ipc.postMessage` → Rust), `PostWebMessageAsString` / `ExecuteScript`
(Rust → JS). That core is obtained the SAME way from a windowed or composition
controller — so this spike wires those exact primitives on a composition-hosted
webview and round-trips a message.

## Prerequisites

GPU + interactive desktop session + WebView2 Evergreen runtime (the app already
requires it). No video / ANGLE / capture needed.

## Build & run

```
cargo run --manifest-path spike/wv2-tauri-ipc/Cargo.toml
```

A small window appears. The spike injects a bootstrap flag, navigates a page that
posts `ping`, replies `pong` from Rust, and the page sets `document.title=IPC_OK`.

## The verdict

- `VERDICT: PASS` — `title=IPC_OK && got_ping`. Init-script injection, JS→Rust
  postMessage, and Rust→JS PostWebMessageAsString all work under composition
  hosting. **Forking wry will carry Tauri invoke/emit intact.**
- `VERDICT: FAIL (NO_BRIDGE)` — `AddScriptToExecuteOnDocumentCreated` did not run.
- `VERDICT: FAIL (round-trip incomplete)` — see `got_ping`: false ⇒ JS→Rust
  failed; true-but-no-IPC_OK ⇒ Rust→JS failed.

## Result on first run (2026-06-23, this repo's dev machine)

```
[spike:ipc] bootstrap script registered (AddScriptToExecuteOnDocumentCreated)
[spike:ipc] WebMessageReceived from JS: "ping"
[spike:ipc] replied pong (PostWebMessageAsString)
[spike:ipc] final title="IPC_OK" got_ping=true
VERDICT: PASS
```

## Decision

See `FORK-PLAN.md` for the fork-vs-bypass decision and the exact wry 0.54.2 delta.
Short version: **FORK wry** — the IPC/protocol/navigation path is unchanged
(proven here); the only new work is the composition-controller creation branch +
`RootVisualTarget` exposure + input forwarding (the latter is C4 work needed by
ANY visual-hosting approach). Bypass would re-implement all of that for no gain.

## Logs

`RUST_LOG=trace` for detail; default `debug`. Tags: `[spike:win]`,
`[spike:dcomp]`, `[spike:ipc]`.
