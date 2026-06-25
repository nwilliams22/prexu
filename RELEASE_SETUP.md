# Private source + public auto-updates — setup & cutover

Prexu's **source and signing key both stay private**. Only the already-public,
signed binaries are mirrored to a separate **public** repo,
[`nwilliams22/prexu-releases`](https://github.com/nwilliams22/prexu-releases),
which the Tauri updater fetches without auth. That public repo holds **no source
and no secrets**.

```
prexu (PRIVATE)                              prexu-releases (PUBLIC)
─ source + minisign signing key              ─ no source, no secrets
─ push tag v*                                ─ just Releases + latest.json
   ├─ build + SIGN (key never leaves here)
   ├─ tauri-action → DRAFT release here
   └─ publish-public job:
        download signed assets
        rewrite latest.json URLs ───────────► upload to a DRAFT Release here
                                              (you review + publish)
app updater endpoint ───────────────────────► …/prexu-releases/releases/latest/download/latest.json
```

## What's already done (in code / on GitHub)

- Public repo `prexu-releases` created — **no build workflow, no secrets**, just
  a README; it only hosts Releases.
- `main` protected (no force-push / deletion) on **both** repos.
- This repo's `release.yml` builds + signs, then mirrors signed binaries +
  URL-rewritten `latest.json` to `prexu-releases` as a **draft** for your review.
- `src-tauri/tauri.conf.json` updater endpoint repointed to `prexu-releases`.

## What YOU must do (needs your credentials — cannot be automated here)

### 1. Create one Personal Access Token (PAT)

Classic PAT with scope **`repo`**, owned by `nwilliams22`, able to write
Releases to `prexu-releases`:
https://github.com/settings/tokens → Generate new token (classic).

> A **fine-grained** PAT scoped to only `prexu-releases` with **Contents:
> read/write** is tighter and preferred if you'd rather not use a classic token.

### 2. Add the secret (private repo only)

The signing key already lives in this repo's secrets. You only add the publish
PAT here — **nothing** goes in the public repo:

```bash
gh secret set RELEASE_PIPELINE_TOKEN -R nwilliams22/prexu --body "<PAT>"
```

> If you override libmpv via `LIBMPV_URL` / `LIBMPV_SHA256` repo *variables*,
> those stay on **this** repo (the build still runs here).

### 3. Test BEFORE going private

While `prexu` is still public, cut a normal release (bump version per CLAUDE.md,
push a `vX.Y.Z` tag). Confirm:
- `build` signs and creates a private draft release, and
- `publish-public` creates a **draft** release on `prexu-releases` whose
  `latest.json` asset URLs point at `prexu-releases`.

Publish that public draft, then verify an installed app updates from it.

### 4. Cutover

No external users yet, so flip to private right after step 3 passes:

```bash
gh repo edit nwilliams22/prexu --visibility private --accept-visibility-change-warning
```

> If Prexu ever gains real users on builds with the **old** endpoint
> (`…/prexu/releases/latest/download/latest.json`), don't flip cold: ship one
> release carrying the new endpoint while `prexu` is still public so installs
> migrate, then go private. Until then this doesn't apply.

### 5. After going private — branch protection note

On a **Free** personal plan, the `main` ruleset stops being *enforced* once a
repo is private (it isn't deleted, just inert). GitHub **Pro** keeps it active.
`prexu-releases` stays public, so its protection holds regardless — and that's
the repo users' updaters actually hit.

### 6. Account hardening (do regardless)

- Enable **2FA**: https://github.com/settings/security
- Consider **pinning third-party GitHub Actions to commit SHAs** in `release.yml`
  / `ci.yml` to remove the compromised-action secret-exfiltration vector.
- Review active sessions / authorized OAuth apps / PATs periodically.
