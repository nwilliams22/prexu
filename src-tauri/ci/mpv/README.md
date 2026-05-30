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

The runtime `libmpv-2.dll` (~119 MB) is **not** stored here — it exceeds
GitHub's 100 MB/file limit. The CI job fetches it from a pinned,
SHA256-checksummed mpv dev release and extracts it into `64/` so `MPV_SOURCE`
resolves a complete directory (see `.github/workflows/ci.yml`, the
"Fetch libmpv runtime DLL" step). `64/libmpv-2.dll` is git-ignored.

Only `mpv.lib` + headers are vendored because the mpv dev archive ships a
MinGW import lib (`libmpv.dll.a`), not the MSVC `mpv.lib` the toolchain links.

## Provenance

Extracted from the same mpv Windows dev kit as the committed
`src-tauri/bin/libmpv-2.dll` (client API `MPV_CLIENT_API_VERSION` 2.5). The
import lib and headers match that DLL's ABI.

## License

The mpv client API headers are **ISC-licensed** (see the copyright banner in
`64/include/mpv/client.h`) specifically to allow redistribution. `mpv.lib`
contains only export symbol stubs generated from the DLL, no mpv source.

## Why vendor the lib + headers but fetch the DLL

The link inputs (`mpv.lib`, headers) are tiny and license-clean, so vendoring
them keeps what we compile/link against pinned and in-repo — no network surface
for the build itself. The 119 MB runtime DLL can't be committed, so it is the
one fetched artifact, and it is pinned by release tag **and** SHA256 so it can't
drift or be swapped. See `prexu-r8o`.
