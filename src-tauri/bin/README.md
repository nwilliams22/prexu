# src-tauri/bin/

Native runtime libraries copied here by `build.rs` so `tauri.conf.json`
can bundle them into release installers. Contents are gitignored — files
are populated at build time.

## libmpv-2.dll (Windows)

Copied from `$MPV_SOURCE/64/libmpv-2.dll`. See
`docs/native-player-status.md` step 1.2 for installing libmpv on a fresh
Windows dev machine. CI runners must set `MPV_SOURCE` before building.

If `MPV_SOURCE` is unset or the file is missing, `build.rs` prints a
warning and continues — the binary will fail at runtime when the player
loads, not at compile time.
