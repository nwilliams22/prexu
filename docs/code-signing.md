# Code Signing — Status and Impact of Bundled libmpv

Assessment for prexu-2zo.4 (Phase 6 of the native player rollout).

## Current state

- **No Authenticode signing.** `src-tauri/tauri.conf.json` has no
  `bundle.windows.certificateThumbprint` and no `signCommand`. Neither the
  installer .exe, the application .exe, nor the bundled libmpv-2.dll are
  Authenticode-signed.
- **Tauri updater signing is unrelated.** The `TAURI_SIGNING_PRIVATE_KEY`
  secret in `release.yml` and the `pubkey` in `plugins.updater` use minisign
  to sign the updater manifest (latest.json + .sig). This authenticates
  update payloads but is invisible to Windows SmartScreen and AV vendors.

## Does SmartScreen flag libmpv specifically?

No — and not because libmpv is fine, but because SmartScreen does not look
inside the installer at individual bundled DLLs.

- SmartScreen evaluates two surfaces: the **installer .exe** when the user
  runs `Prexu_<ver>_x64-setup.exe`, and the **application .exe** the first
  time it launches after install. Both checks are signature reputation
  lookups against Microsoft's known-publisher database.
- The bundled libmpv-2.dll is extracted to the install directory and loaded
  at runtime via `LoadLibrary` (delay-loaded — see `src-tauri/build.rs:16`).
  Windows does not enforce signature validation on user-mode DLL loads, so
  libmpv-2.dll's signing status never gates anything.
- The "Windows protected your PC" warning currently shown on first install
  is caused by the unsigned installer/.exe itself, not by anything inside
  the bundle. Adding Authenticode signing to those two binaries removes the
  warning regardless of what we do (or don't do) to the DLLs.

## Antivirus considerations

Larger third-party native libraries occasionally trip heuristic detections
in less-popular AV engines. libmpv-2.dll is ~25 MB with high code entropy.

- Unsigned + large + uncommon publisher = the worst case for false-positive
  rates. Once we sign, the publisher reputation generally clears these.
- If a specific vendor flags us post-signing, the path is to submit the
  installer to that vendor's analyst portal. Microsoft Defender accepts
  submissions at https://www.microsoft.com/en-us/wdsi/filesubmission.

## Recommended path forward (when we sign)

1. **Cert procurement.** EV code-signing certificate ($300–500/yr from
   DigiCert / SSL.com / Sectigo). EV grants instant SmartScreen reputation;
   OV requires building reputation over weeks/downloads.
2. **`tauri.conf.json` change.** Add under `bundle.windows`:
   ```json
   "signCommand": "signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /sha1 ${env.WINDOWS_CERT_THUMBPRINT} %1"
   ```
   `%1` is the file path Tauri injects per artifact. Tauri v2's `signCommand`
   runs over the main app .exe and the NSIS installer .exe.
3. **Sign bundled DLLs too** (recommended). Tauri's per-artifact signCommand
   does not loop over bundled resources by default. Two options:
   - Sign libmpv-2.dll in CI **before** the Tauri build step: `signtool sign
     ... C:\libmpv\64\libmpv-2.dll`. The build.rs copy then carries the
     signature into `src-tauri/bin/` and into the installer.
   - Or use NSIS's `!packhdr` hook to sign the installer payload
     post-compression. More fragile; the CI pre-sign approach is simpler.
4. **GitHub secrets needed.** `WINDOWS_CERT_THUMBPRINT` (or the cert .pfx +
   password if not using a HSM-backed cert). The signtool invocation
   resolves the cert from the local cert store by thumbprint.
5. **Timestamp server is mandatory.** Without `/tr`, the signature expires
   when the cert does. With `/tr`, signed binaries remain valid past cert
   expiration as long as the timestamp covers the signing event.

## Decision

Code signing is a separate epic — it's pre-existing tech debt, not
introduced by Phase 2's native-player work. The bundled libmpv-2.dll does
not change the SmartScreen calculus: we already had unsigned installers,
and we'll continue to have unsigned installers until the cert is procured.

When code signing lands, sign libmpv-2.dll as part of the same workflow so
AV heuristics don't single it out. No other libmpv-specific changes are
required.
