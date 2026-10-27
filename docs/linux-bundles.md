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

The workflow builds unmodified mpv 0.39.0 and FFmpeg 7.1.5 source archives,
verifies SHA-256 pins, and installs shared libraries into an isolated prefix.
mpv uses `-Dgpl=false -Dlibmpv=true -Dcplayer=false`; FFmpeg uses
`--enable-shared --disable-static --disable-gpl --disable-nonfree
--disable-version3 --disable-autodetect`. OpenSSL, zlib and VAAPI are explicitly
enabled. Native FFmpeg decoders remain available; GPL-only external codecs are
not enabled. This is a render-API library build, not a standalone mpv player.
All configure commands and pins are in `.github/workflows/release.yml`.

These choices follow [mpv's LGPL build instructions](https://github.com/mpv-player/mpv/blob/v0.39.0/Copyright)
and [FFmpeg's shared-library build guidance](https://ffmpeg.org/legal.html).
The AppImage carries the exact source archives, license texts and configuration
logs under `usr/share/doc/prexu/media`. Candidate artifacts include the same
records separately. FFmpeg library license strings and the bundled mpv client
API are checked after extraction. The rpm links the distro's `libmpv.so.2` at
runtime; distro package maintainers control its build and license choices.

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

## Acceptance status

The implementation has not yet passed a commit-specific candidate run. Do not
infer that the bundles work from workflow syntax checks or an unrelated green
CI build. `prexu-axj4.7` remains open until the actual AppImage/rpm inspection,
native-startup logs and the implementation commit's Actions result are recorded.
