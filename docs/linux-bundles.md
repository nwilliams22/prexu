# Linux bundle construction and acceptance

The release workflow uses Ubuntu 24.04 for Linux, setting a **glibc 2.39 or
newer** compatibility baseline. This deliberately drops Ubuntu 22.04 and older
hosts. It avoids maintaining a separate old-distro graphics development stack;
AppImage does not make a newer glibc-linked executable portable to older glibc.
The rpm declares the same baseline. A compatible distro must also supply the
named WebKitGTK 4.1, GTK 3, OpenSSL 3 and libmpv API 2 runtime capabilities.

## Media provenance

Do not substitute Ubuntu's `libmpv-dev` in this workflow. The old Ubuntu 22.04
build embedded `libmpv.so.1`, which cannot satisfy the Rust binding's API 2
check. Merely moving to an API 2 distro package does not establish an LGPL build.

The workflow verifies SHA-256 pins for mpv 0.39.0 and FFmpeg 7.1.5 source
archives, then backports mpv [72d43dc](https://github.com/mpv-player/mpv/commit/72d43dc9c999a21d867cdc0f934f3e4cd2195aa9)
using `scripts/patches/mpv-scaler-lut-padding.patch` before building shared
libraries into an isolated prefix. The patch initializes unused scaler lookup
texture lanes. Without it, heap NaNs can turn valid decoded video black despite
successful render calls; this reproduced with Mesa llvmpipe and distro mpv 0.37.0.
mpv uses `-Dgpl=false -Dlibmpv=true -Dcplayer=false`; FFmpeg uses
`--enable-shared --disable-static --disable-gpl --disable-nonfree
--disable-version3 --disable-autodetect`. OpenSSL, zlib and VAAPI are explicitly
enabled. Native FFmpeg decoders remain available; GPL-only external codecs are
not enabled. This is a render-API library build, not a standalone mpv player.
All configure commands and pins are in `.github/workflows/release.yml`.

These choices follow [mpv's LGPL build instructions](https://github.com/mpv-player/mpv/blob/v0.39.0/Copyright)
and [FFmpeg's shared-library build guidance](https://ffmpeg.org/legal.html).
The AppImage carries the exact source archives, the applied patch, license texts and configuration
logs under `usr/share/doc/prexu/media`. Candidate artifacts include the same
records separately. FFmpeg library license strings and the bundled mpv client
API are checked after extraction. The rpm links the distro's `libmpv.so.2` at
runtime; distro package maintainers control its build and license choices.
The rpm therefore also needs a distro libmpv containing the scaler-padding fix;
API 2 compatibility alone does not establish correct visible playback.

LGPL mode disables some mpv backends, including standalone X11 video output
and VDPAU. Prexu uses the OpenGL render API instead. These packaging changes do
not certify hardware decoding, audio devices or GPU coverage.

## Candidate workflow (no release)

Packaging changes on `main` automatically build Linux candidates. You can also
run the **Release** workflow manually on the intended branch. Non-tag runs
build only Linux and upload `linux-bundles-<commit>`; they do not create tags,
GitHub releases or run release cleanup. Tag-triggered runs retain the existing
Windows/Linux draft release path. Publishing a release remains an owner action.

The workflow extracts its own AppImage and records:

```sh
readelf -d squashfs-root/usr/bin/prexu
find squashfs-root -name 'libmpv*'
rpm -qp --requires Prexu-*.rpm
```

It requires `libmpv.so.2` in the executable's NEEDED entries and the bundle,
rejects any bundled `libmpv.so.1`, and checks every direct ELF dependency against
the rpm's declared capabilities. Transitive dependencies of distro libraries are
resolved by their packages; an AppImage's bundled set is not itself an rpm
requirement list. The separate FFmpeg/API probe opens the extracted libraries
without the build prefix and creates an mpv handle.

The extracted `AppRun` is launched under Xvfb with the build prefix removed from
`LD_LIBRARY_PATH`, software GL, and no DMABUF-disabling override. It must remain
alive through the 30-second window and log both `[player] mpv created` and
`[player:linux] compositor installed`, with no version mismatch or fallback.
Startup alone does not prove playback, audio output or hardware acceleration.

## Published release-page gate

After publishing a stable tag, run the gate against the assets on that tag's
GitHub release page. Candidate CI artifacts do not substitute for this check:

```sh
python3 scripts/check-published-linux.py v0.8.2 --output /tmp/prexu-v0.8.2-check
```

Use a new output directory each time (existing directories are rejected). Without
`--output`, the script creates and prints a temporary directory. Assets and
`release.json`, `extract.log`, `needed.log`, `rpm-requires.log`,
`media-runtime.log`, and `native-startup.log` remain there for inspection, even
on failure. Capture stdout/stderr with the exit status in the release ticket.
The command exits non-zero on a failed check or missing prerequisite.

Run on x86_64 Linux with glibc 2.39+, Python 3.11+, curl, binutils (`readelf`),
coreutils (`timeout`), Xvfb, `xvfb-run`, xauth, `dbus-run-session`, and the
AppImage's host graphics/runtime dependencies. An Ubuntu 24.04 desktop or the
Linux release workflow's provisioned host is suitable. No `rpm` binary, rpm
Python module, FUSE mount, GitHub login, or live Plex account is required. Public
GitHub API rate limits apply. Only run released binaries you intend to trust.

The script downloads the x86_64 AppImage, rpm and `latest.json`, requires HTTP
200, and compares each SHA-256 with its GitHub release API digest before
extracting or executing anything. It requires `libmpv.so.2` in the executable's
NEEDED entries and the extracted bundle, rejects bundled `libmpv.so.1*`, probes
the bundled mpv client API for major version 2, and checks every direct NEEDED
soname against the rpm's REQUIRENAME capabilities. The narrow rpm parser reads
the [v4 package headers](https://rpm.org/docs/6.0.x/manual/format_v4.html) directly;
it does not resolve or install packages on the host.

Native startup runs extracted `AppRun` under Xvfb with software GL, fresh HOME
and XDG directories. It measures a 30-second survival window and applies the
same marker/fallback conditions as the candidate workflow. It does not read saved Plex credentials or change
local app preferences. This tests startup, not visible playback, audio, hardware
decode, or a real display session.

Updater metadata must name the requested version, exactly the six Linux/Windows
x86_64 platform keys, matching architecture/format release-asset URLs, and
minisign signature packets carrying the key ID from `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`.
`--config PATH` selects another trusted configuration for a historical release
whose signing key differs. This checks signature **key IDs**, not cryptographic
signature validity or an end-to-end updater installation; Windows assets are
not downloaded by this Linux gate. The generic Linux alias targets AppImage;
the generic Windows alias targets MSI. Draft and prerelease releases are rejected
even when their tags have the stable version format.

The parser and failure conditions have offline negative controls:

```sh
python3 -m unittest discover -s scripts -p 'test_check_published_linux.py' -v
```

## Acceptance status

The published `v0.8.2` gate passed on 2026-10-29: all three release API digests
matched, all 18 direct ELF dependencies had rpm requirement capabilities,
bundled mpv reported client API 2.3, and native startup passed the 30-second Xvfb
check. All six updater entries carried key ID `2AF3238422A296B1`.
This evidence is specific to that release and host. Broader distribution and
hardware acceptance remains tracked by `prexu-axj4.7`; rerun this gate for every
published release.
