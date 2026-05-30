# Vendored libmpv dev kit (CI only)

This directory holds the minimal libmpv build-time artifacts needed to compile
and link the `headless_mpv` integration test (`src-tauri/tests/headless_mpv.rs`)
on a CI runner that does not have a full mpv install.

## Contents

```
64/
  mpv.lib              # MSVC import library (symbol stubs, ~52 KB — not mpv itself)
  include/mpv/*.h      # client API headers: client, render, render_gl, stream_cb
```

The runtime `libmpv-2.dll` is **not** duplicated here — it already lives in
`src-tauri/bin/libmpv-2.dll` and the CI job copies it into this layout at build
time so `MPV_SOURCE` resolves a complete `64/` directory.

## Provenance

Extracted from the same mpv Windows dev kit as the committed
`src-tauri/bin/libmpv-2.dll` (client API `MPV_CLIENT_API_VERSION` 2.5). The
import lib and headers match that DLL's ABI.

## License

The mpv client API headers are **ISC-licensed** (see the copyright banner in
`64/include/mpv/client.h`) specifically to allow redistribution. `mpv.lib`
contains only export symbol stubs generated from the DLL, no mpv source.

## Why vendored instead of downloaded in CI

Fetching a dev kit over the network in CI is a supply-chain risk and a flake
source (unpinned URLs, mirror outages). These artifacts are tiny, license-clean,
and pinned to the exact DLL we ship, so vendoring keeps the CI job deterministic
and offline. See `prexu-r8o`.
