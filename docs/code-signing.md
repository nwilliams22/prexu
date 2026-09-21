# Code signing and native artifact verification

Audited 2026-09-20 against Tauri configuration, `build.rs`, the release workflow,
and `src-tauri/src/player/angle_loader.rs`. This records repository behavior;
it does not certify an externally downloaded installer or certificate policy.

## Configured behavior

- The repository does not configure Windows installer/application Authenticode
  signing (`certificateThumbprint` / `signCommand`). Do not infer that an
  externally produced artifact is signed from updater support.
- The release workflow supplies `TAURI_SIGNING_PRIVATE_KEY` for Tauri updater
  artifact signatures. These are separate from Windows Authenticode signing.
- Windows libmpv downloads are SHA-256 checked against the workflow pin.
- ANGLE DLLs (`libEGL.dll`, `libGLESv2.dll`) are downloaded/staged separately;
  the application verifies pinned SHA-256 hashes and Authenticode signatures
  before loading them. Headless Windows CI uses stubs and skips the two real
  artifact-integrity tests.
- Windows release builds require an explicit `MPV_SOURCE`; the debug-only
  `C:\libmpv` convenience fallback is disabled for release builds.
- No macOS release/notarization job is configured. Native dylib distribution
  and signing remain part of `prexu-ia6w.9`.

## Future signing work

Adding application/installer signing requires a selected signing service or
certificate, CI credential provisioning, and verification of the resulting
artifacts. This repo has not implemented that workflow. Reassess provider
requirements when that work starts; old price estimates and promises of instant
SmartScreen reputation are not maintained guidance.

Do not re-sign or substitute pinned third-party DLLs without reviewing their
hash/signature checks and updating provenance deliberately. Signing the app is
separate from verifying dependencies and does not replace vulnerability scanning.
See [Windows binary setup](../src-tauri/bin/README.md).
