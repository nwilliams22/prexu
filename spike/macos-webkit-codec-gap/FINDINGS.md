# macOS WKWebView codec-decode gap — findings (prexu-ia6w.1)

Measures the real codec-decode capability of the WKWebView engine Tauri uses
on macOS, for the prexu-duna.3 codec set, to decide whether macOS needs a
native libmpv player by default or whether the HTML5 `<video>` path already
covers most of the gap. Every cell below traces to an observed probe or
playback result logged during a real WKWebView run — see the appendix for
the raw JSON.

## Environment

| | |
|---|---|
| macOS | 26.5.2 (BuildVersion 25F84, Tahoe) |
| Chip | Apple M3 Pro (`hw.model: Mac15,7`, arm64) |
| WebKit framework | `CFBundleVersion 21624.2.5.11.8` (`CFBundleShortVersionString 21624`), `DTPlatformVersion 26.5` |
| Safari.app version (same engine family) | 26.5.2 |
| WKWebView UA reported at runtime | `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)` — WebKit's standard generic/masked UA; it does not report Apple Silicon or the real WebKit build number, hence the framework-plist lookup above for the real version |
| ffmpeg | 8.1.2 (Homebrew) |
| mpv | 0.41.0 (Homebrew, libplacebo v7.360.1, built against ffmpeg 8.1.1 runtime 8.1.2) |
| Route used | **Preferred route**: a ~90-line Swift file (`swiftc`-compiled) creating a real `WKWebView` in a visible `NSWindow`, loading `harness.html` served by `python3 -m http.server` on `127.0.0.1:8743`, receiving the result JSON via a `WKScriptMessageHandler` (`window.webkit.messageHandlers.probeDone`), and printing it to stdout. This is the actual WKWebView engine — the same one Tauri's macOS webview embeds. |

**Important run detail**: the first run of the Swift runner attached the
`WKWebView` to an off-screen view with no backing `NSWindow`. Video playback
silently stalled after the first sample (`hevc8_aac.mp4` never completed
within a 60s budget) — WKWebView throttles/suspends the media pipeline when
not attached to a real, key/visible window. Fixed by creating and
`makeKeyAndOrderFront`-ing an actual `NSWindow` and setting it as
`contentView`. This matters for anyone reusing this harness: **a headless or
unattached WKWebView does not exercise the same decode path as production.**

## Per-codec verdict table

`canPlayType` and `MediaCapabilities` are *probes* (self-reported by
WebKit); the file-src and MSE-probe columns come from the harness described
below. "Real playback" is the truth test — actual decoded video frames via
`requestVideoFrameCallback`/`getVideoPlaybackQuality`, or actual non-silent
PCM out of `AudioContext.decodeAudioData` for audio.

### Video

| Codec | canPlayType | MediaCapabilities (file / media-source) | Real file-src playback | MSE probe | Verdict |
|---|---|---|---|---|---|
| H.264 High (`avc1.640028`) | `probably` | supported/supported | 10 `rVFC` callbacks fired, `totalVideoFrames=2`, no dropped/corrupted frames | `MediaSource.isTypeSupported=true` | **Decodes** (baseline — already worked on Linux webkit2gtk too) |
| HEVC 8-bit Main (`hvc1.1.6.L93.B0`) | `probably` | supported/supported | 10 `rVFC` callbacks, `totalVideoFrames=2` | `true` | **Decodes** |
| HEVC 10-bit Main 10 (`hvc1.2.4.L93.B0`) | `probably` | supported/supported | 10 `rVFC` callbacks, `totalVideoFrames=4` | `true` | **Decodes** |
| AV1 Main profile 8-bit (`av01.0.04M.08`) | `probably` | supported/supported | 10 `rVFC` callbacks, `totalVideoFrames=1` | `true` | **Decodes** — see AV1 caveat below |

### Audio

| Codec | canPlayType | MediaCapabilities (file / media-source) | Real decode (`decodeAudioData`) | MSE probe | Verdict |
|---|---|---|---|---|---|
| AAC-LC (`mp4a.40.2`) | `probably` | supported/supported (smooth=false¹) | non-silent, `maxAbsSample=0.144`, 5.0s decoded | `true` | **Decodes** |
| AC3 (`ac-3`) | `probably` | supported/supported (smooth=false¹) | non-silent, `maxAbsSample=0.125`, 5.01s decoded | `true` | **Decodes** |
| E-AC3 (`ec-3`) | `probably` | supported/supported (smooth=false¹) | non-silent, `maxAbsSample=0.125`, 5.01s decoded | `true` | **Decodes** |
| TrueHD, mp4 (`mlpa`) | `""` (no) | unsupported/unsupported | **error**, `decodeAudioData` rejected (no `AudioBuffer`) | `false` | **Does not decode** |
| TrueHD, mkv | n/a (no web MIME for mkv+mlpa) | n/a | **error**, identical rejection to the mp4 copy of the same codec | n/a | **Does not decode** (codec-level, not container-level — mp4 copy fails identically) |
| DTS core, mp4 (`dtsc`) | `""` (no) | unsupported/unsupported | **error**, rejected | `false` | **Does not decode** |
| DTS core, mkv | n/a | n/a | **error**, rejected (same as mp4 copy) | n/a | **Does not decode** (codec-level) |
| DTS core, mov (`audio/quicktime; codecs="dtsc"`) | `""` (no) | `MediaCapabilities.decodingInfo` **threw** `TypeError: Type error` (the `audio/quicktime` contentType isn't a config WebKit's API accepts — probe artifact, not a capability signal) | **error**, rejected | `false` | **Does not decode** |

¹ `smooth: false` / `powerEfficient: false` appeared for every audio codec including AAC — this looks like an artifact of the synthetic `MediaCapabilities` config (framerate/bitrate guesses for an audio-only query) rather than a real smoothness judgment; `supported` is the meaningful field and it is consistent with the real-decode result in every row.

### Muxed (video+audio combined `canPlayType`, the check closest to what `canDirectPlay()` effectively asks)

| Muxed file | canPlayType | MSE |
|---|---|---|
| H.264 + AAC | `probably` | `true` |
| H.264 + AC3 | `probably` | `true` |
| H.264 + E-AC3 | `probably` | `true` |
| HEVC 8-bit + AAC | `probably` | `true` |
| HEVC 10-bit + AAC | `probably` | `true` |
| AV1 + AAC | `probably` | `true` |
| H.264 + TrueHD | `""` (no) | `false` |
| H.264 + DTS | `""` (no) | `false` |

### AV1 caveat (must read before generalizing this result)

AV1 real playback succeeded on **this** machine, an **Apple M3 Pro**. Apple's
hardware AV1 decode block shipped starting with the M3 generation; per the
mission brief's own framing, AV1 is expected to work "only on M3+ hardware."
This spike had access to only one machine (M3 Pro) — **AV1 support on M1/M2
Apple Silicon Macs is untested and should not be assumed identical.** If
prexu ships to M1/M2 users, AV1 direct play should not be enabled
unconditionally from this result alone; a per-device capability check
(`MediaCapabilities.decodingInfo` at runtime, which is exactly what this
harness exercises) is the safe way to gate it rather than a static
allow-list.

## Library-impact re-application (macOS WKWebView vs. the duna.3 Linux baseline)

Reusing the duna.3 counts verbatim (platform-independent library facts, not
re-derived here): **Movies section = 3240 items.**

### Video

- Linux (webkit2gtk) baseline: 560 HEVC (547 of them 10-bit) + 2 AV1 = **562 / 3240 ≈ 17.3%** forced a Plex transcode.
- macOS WKWebView **engine capability** (this spike): HEVC 8-bit, HEVC
  10-bit, and AV1 all produced real decoded frames in `<video src>` playback.
  Technically, **0 of the 562** video-forcing-transcode titles are blocked by
  a WKWebView decode gap: 562 − 562 = **0 / 3240 (0%)** would need a video
  transcode purely on codec-decode grounds.
- **But** — this improvement is not automatic. `src/services/plex-playback.ts`'s
  `canDirectPlay()` gates direct play on a hardcoded, platform-blind codec
  list:
  ```ts
  const DIRECT_PLAY_VIDEO_CODECS = ["h264", "avc1"];
  ```
  This list does not vary by platform. So **as the code ships today**, macOS
  gets the *exact same* 562/3240 (17.3%) forced-transcode behavior as Linux,
  even though the underlying WKWebView is capable — the app never asks it to
  try. Realizing the 17.3% → 0% improvement requires adding `"hevc"`/`"hvc1"`
  and `"av1"`/`"av01"` to `DIRECT_PLAY_VIDEO_CODECS` (macOS-gated, given the
  AV1 hardware caveat above), or a runtime `MediaCapabilities.decodingInfo`
  check in place of the static list.

### Audio

- Linux baseline: AC3 74 + EAC3 68 + TrueHD 10 + DTS/DTS-HD MA 18 = **170 titles** forced a transcode.
- macOS WKWebView capability: AC3 and E-AC3 both produced real non-silent
  decoded PCM (`decodeAudioData`); TrueHD and DTS/DTS-HD MA both failed
  decode in every container tried (mkv, mp4, and — for DTS — mov).
  - AC3 + EAC3 = 74 + 68 = **142 titles** are within WKWebView's real audio
    decode capability.
  - TrueHD (10) + DTS/DTS-HD MA (18) = **28 titles** remain genuinely
    undecodable by WKWebView — no improvement possible without transcoding
    or bundling a native player.
  - Best case if the app is updated: 170 → 28 forced-transcode titles, an
    **83.5% reduction** in audio-transcode-forcing titles (142 avoided / 170).
- **Same platform-blind-gate caveat applies to audio.** `canDirectPlay()`'s
  `DIRECT_PLAY_AUDIO_CODECS = ["aac", "mp3", "flac", "opus"]` does not
  include `ac3`/`eac3`, so on macOS today AC3/E-AC3 titles still fail
  `canDirectPlay()` and route through `buildTranscodeUrl()` exactly as on
  Linux — **no behavior change without an app update.**
  - One nuance specific to the transcode path: `buildTranscodeUrl()`'s
    `canDirectStreamAudio()` / `HLS_DIRECT_AUDIO_CODECS` **already** includes
    `ac3`/`eac3` (platform-independently), so even today, when an AC3/EAC3
    title falls through to the transcode endpoint, Plex is told
    `directStreamAudio=1` and only remuxes rather than fully re-encoding
    audio — this is not new to macOS, it's pre-existing behavior on both
    platforms. The gap this spike identifies is specifically about **full
    direct play** (`canDirectPlay()`, no Plex transcoder session at all),
    where the static `DIRECT_PLAY_AUDIO_CODECS` list is the blocker.
- No de-duplication was performed between the video-forcing-transcode set
  (562 titles) and the audio-forcing-transcode set (170 titles) — a title
  could appear in both (e.g., an HEVC file with AC3 audio). The duna.3 source
  numbers were given as separate category counts without an intersection, so
  this re-application preserves that same shape rather than fabricating a
  dedup that the underlying per-title codec matrix wasn't provided for.

### `plex-playback.ts` client profile — does it need updating for macOS?

`buildTranscodeUrl()`'s `X-Plex-Client-Profile-Extra` already advertises:
```
add-transcode-target(...&videoCodec=h264,hevc&audioCodec=aac,mp3,ac3,eac3)
add-limitation(scope=videoCodec&scopeName=hevc&type=upperBound&name=video.bitDepth&value=10)
```
So the **transcode-target profile Plex sees is already HEVC/10-bit-aware and
AC3/EAC3-audio-aware**, independent of platform — this part needs no change
to exploit WKWebView's HEVC support in the *transcode* (HLS) path. The gap is
entirely upstream of this profile, in `canDirectPlay()`'s static codec
allow-list, which decides whether the transcode path is invoked **at all**.
AV1 is not mentioned anywhere in the client profile string either — if AV1
direct play is added, no profile change is needed there since AV1 items
would bypass the transcode endpoint entirely (direct play), but if AV1 must
ever fall back to transcode (e.g., unsupported chip at runtime), the profile
would need an AV1 transcode-target entry, which is currently absent.

## Surprises / caveats

- **AV1 decodes on this hardware** — genuinely surprising given the Linux
  baseline treated AV1 as unconditionally transcode-forcing; on macOS M3+ it
  is not. This is the single highest-value finding for the "native player or
  not" decision, but is chip-gated (see AV1 caveat above) — do not generalize
  to all Apple Silicon without further per-chip testing.
- **HEVC 10-bit works with no caveats observed** — both `hevc10_aac.mp4`
  probes and real playback (`totalVideoFrames=4`, the highest frame count of
  any video sample tested) succeeded cleanly.
- **TrueHD and DTS/DTS-HD MA are categorically unsupported** — every probe
  method (canPlayType, MSE, MediaCapabilities) and the real-decode truth test
  agreed, across every container tried (mkv, mp4, mov for DTS). No container
  trick unlocks these; a native player is the only way to play them without
  a Plex transcode.
- **The engine-capability vs. app-behavior gap is the real headline.** The
  webview can already decode over 80% of what currently forces a Linux
  transcode (562 HEVC/AV1 video + 142 of 170 audio titles), but
  `plex-playback.ts`'s codec allow-lists are platform-blind, so **none of
  that capability is used today on macOS.** This reframes the native-player
  decision: it isn't only "does WKWebView cover the gap" but also "is
  `canDirectPlay()` updated to let it."
  - The mission brief only asked this spike to *measure* WKWebView, not to
    change app code — no changes were made to `src/services/plex-playback.ts`
    or any other production source. This is a recommendation for a follow-up
    task, not a change applied here.
- **A WKWebView with no backing window silently stalls media decode** after
  the first sample (see "Important run detail" above) — worth remembering
  for any future harness reuse (e.g., a CI headless probe would need to
  either keep a window or accept this limitation).
- **`decodeAudioData`'s rejection value is a bare `null`, not an `Error`,**
  in this WebKit build's legacy callback path — the harness's `error` field
  for TrueHD/DTS rows literally reads the string `"null"` for that reason;
  it's still an unambiguous failure signal (no `AudioBuffer` was produced,
  `nonSilent` stayed `null`), just documenting the odd string.
- `MediaCapabilities.decodingInfo({ type, audio: { contentType: 'audio/quicktime; codecs="dtsc"' } })`
  threw a `TypeError` rather than resolving `supported: false` — recorded
  as a probe artifact (this contentType/config combination isn't one the API
  accepts) rather than a capability signal; canPlayType and real decode
  already gave an unambiguous "no" for the same file.
- `ManagedMediaSource` is present (`true`) alongside standard `MediaSource`
  in this WebKit build, for completeness — not otherwise exercised, since no
  MSE-based playback path (hls.js) was run against these files (all real
  playback tests used a plain `<video src>` file source, which is what
  `useHtml5Player`'s direct-play path also uses for local/direct-play URLs;
  the transcode path uses hls.js/MSE and was not truth-tested here, only
  probed).

## Follow-ups (explicitly out of scope for this spike)

- No Plex server auth or end-to-end streaming was attempted (per mission
  rules). The above is codec-decode capability only; an actual Plex
  direct-play/transcode-selection end-to-end test against a real library is
  a follow-up.
- AV1 decode retest on M1/M2 Apple Silicon hardware.
- If `canDirectPlay()`'s codec allow-lists are updated to exploit this
  capability, that is new app-code work requiring its own testing (TS unit
  tests + a manual HEVC/AV1 file play-through), not performed here.
- hls.js/MSE-path real playback truth test (as opposed to the MSE
  `isTypeSupported` probe done here) for the transcode/remux path.

## Files

- `spike/macos-webkit-codec-gap/harness.html` — the probe + real-playback harness (self-contained, no build step; loaded via `python3 -m http.server`).
- `spike/macos-webkit-codec-gap/probe-results.json` — the exact JSON emitted by the harness during the WKWebView run reported above (same content as the appendix below, kept as a separate file for tooling convenience).
- `spike/macos-webkit-codec-gap/samples/` — gitignored; see repo `.gitignore` in this directory. Contains all 11 test files (`av1_aac.mp4`, `h264_aac.mp4`, `h264_ac3.mp4`, `h264_eac3.mp4`, `h264_dts.mkv`, `h264_dts.mp4`, `h264_dts.mov`, `h264_truehd.mkv`, `h264_truehd.mp4`, `hevc10_aac.mp4`, `hevc8_aac.mp4`). Note: `h264_truehd.mov` was attempted and rejected by ffmpeg's own mov muxer (`"truehd only supported in MP4"`) — a genuine container-level limitation, not a gap in this testing; no `.mov` TrueHD file exists as a result.

## Appendix — raw probe/playback JSON

```json
{
  "env": {
    "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
    "platform": "MacIntel",
    "hasMediaSource": true,
    "hasManagedMediaSource": true,
    "hasWebKitMediaSource": false,
    "hasMediaCapabilities": true,
    "location": "http://127.0.0.1:8743/harness.html"
  },
  "codecs": {
    "h264-baseline": {
      "mime": "video/mp4; codecs=\"avc1.42E01E\"",
      "kind": "video",
      "note": null,
      "canPlayType": "probably",
      "mse": {
        "MediaSource": true,
        "ManagedMediaSource": true
      },
      "mediaCapabilities": {
        "file": {
          "supported": true,
          "smooth": true,
          "powerEfficient": true
        },
        "mediaSource": {
          "supported": true,
          "smooth": true,
          "powerEfficient": true
        }
      }
    },
    "h264-high": {
      "mime": "video/mp4; codecs=\"avc1.640028\"",
      "kind": "video",
      "note": null,
      "canPlayType": "probably",
      "mse": {
        "MediaSource": true,
        "ManagedMediaSource": true
      },
      "mediaCapabilities": {
        "file": {
          "supported": true,
          "smooth": true,
          "powerEfficient": true
        },
        "mediaSource": {
          "supported": true,
          "smooth": true,
          "powerEfficient": true
        }
      }
    },
    "hevc-main-8bit": {
      "mime": "video/mp4; codecs=\"hvc1.1.6.L93.B0\"",
      "kind": "video",
      "note": null,
      "canPlayType": "probably",
      "mse": {
        "MediaSource": true,
        "ManagedMediaSource": true
      },
      "mediaCapabilities": {
        "file": {
          "supported": true,
          "smooth": true,
          "powerEfficient": true
        },
        "mediaSource": {
          "supported": true,
          "smooth": true,
          "powerEfficient": true
        }
      }
    },
    "hevc-main10-10bit": {
      "mime": "video/mp4; codecs=\"hvc1.2.4.L93.B0\"",
      "kind": "video",
      "note": null,
      "canPlayType": "probably",
      "mse": {
        "MediaSource": true,
        "ManagedMediaSource": true
      },
      "mediaCapabilities": {
        "file": {
          "supported": true,
          "smooth": true,
          "powerEfficient": true
        },
        "mediaSource": {
          "supported": true,
          "smooth": true,
          "powerEfficient": true
        }
      }
    },
    "av1-main-8bit": {
      "mime": "video/mp4; codecs=\"av01.0.04M.08\"",
      "kind": "video",
      "note": null,
      "canPlayType": "probably",
      "mse": {
        "MediaSource": true,
        "ManagedMediaSource": true
      },
      "mediaCapabilities": {
        "file": {
          "supported": true,
          "smooth": true,
          "powerEfficient": true
        },
        "mediaSource": {
          "supported": true,
          "smooth": true,
          "powerEfficient": true
        }
      }
    },
    "aac-lc": {
      "mime": "audio/mp4; codecs=\"mp4a.40.2\"",
      "kind": "audio",
      "note": null,
      "canPlayType": "probably",
      "mse": {
        "MediaSource": true,
        "ManagedMediaSource": true
      },
      "mediaCapabilities": {
        "file": {
          "supported": true,
          "smooth": false,
          "powerEfficient": false
        },
        "mediaSource": {
          "supported": true,
          "smooth": false,
          "powerEfficient": false
        }
      }
    },
    "ac3": {
      "mime": "audio/mp4; codecs=\"ac-3\"",
      "kind": "audio",
      "note": null,
      "canPlayType": "probably",
      "mse": {
        "MediaSource": true,
        "ManagedMediaSource": true
      },
      "mediaCapabilities": {
        "file": {
          "supported": true,
          "smooth": false,
          "powerEfficient": false
        },
        "mediaSource": {
          "supported": true,
          "smooth": false,
          "powerEfficient": false
        }
      }
    },
    "eac3": {
      "mime": "audio/mp4; codecs=\"ec-3\"",
      "kind": "audio",
      "note": null,
      "canPlayType": "probably",
      "mse": {
        "MediaSource": true,
        "ManagedMediaSource": true
      },
      "mediaCapabilities": {
        "file": {
          "supported": true,
          "smooth": false,
          "powerEfficient": false
        },
        "mediaSource": {
          "supported": true,
          "smooth": false,
          "powerEfficient": false
        }
      }
    },
    "truehd-mp4": {
      "mime": "audio/mp4; codecs=\"mlpa\"",
      "kind": "audio",
      "note": null,
      "canPlayType": "(empty string = no)",
      "mse": {
        "MediaSource": false,
        "ManagedMediaSource": false
      },
      "mediaCapabilities": {
        "file": {
          "supported": false,
          "smooth": false,
          "powerEfficient": false
        },
        "mediaSource": {
          "supported": false,
          "smooth": false,
          "powerEfficient": false
        }
      }
    },
    "truehd-mkv": {
      "mime": null,
      "kind": "audio",
      "note": "mkv container has no registered web MIME/codec string; probe skipped, playback-only",
      "canPlayType": "n/a",
      "mse": "n/a",
      "mediaCapabilities": {
        "file": "n/a",
        "mediaSource": "n/a"
      }
    },
    "dts-mp4": {
      "mime": "audio/mp4; codecs=\"dtsc\"",
      "kind": "audio",
      "note": null,
      "canPlayType": "(empty string = no)",
      "mse": {
        "MediaSource": false,
        "ManagedMediaSource": false
      },
      "mediaCapabilities": {
        "file": {
          "supported": false,
          "smooth": false,
          "powerEfficient": false
        },
        "mediaSource": {
          "supported": false,
          "smooth": false,
          "powerEfficient": false
        }
      }
    },
    "dts-mkv": {
      "mime": null,
      "kind": "audio",
      "note": "mkv container has no registered web MIME/codec string; probe skipped, playback-only",
      "canPlayType": "n/a",
      "mse": "n/a",
      "mediaCapabilities": {
        "file": "n/a",
        "mediaSource": "n/a"
      }
    },
    "dts-mov": {
      "mime": "audio/quicktime; codecs=\"dtsc\"",
      "kind": "audio",
      "note": null,
      "canPlayType": "(empty string = no)",
      "mse": {
        "MediaSource": false,
        "ManagedMediaSource": false
      },
      "mediaCapabilities": {
        "file": "throw: TypeError: Type error",
        "mediaSource": "throw: TypeError: Type error"
      }
    }
  },
  "muxed": {
    "muxed-h264-aac": {
      "mime": "video/mp4; codecs=\"avc1.640028,mp4a.40.2\"",
      "canPlayType": "probably",
      "mse": {
        "MediaSource": true,
        "ManagedMediaSource": true
      }
    },
    "muxed-h264-ac3": {
      "mime": "video/mp4; codecs=\"avc1.640028,ac-3\"",
      "canPlayType": "probably",
      "mse": {
        "MediaSource": true,
        "ManagedMediaSource": true
      }
    },
    "muxed-h264-eac3": {
      "mime": "video/mp4; codecs=\"avc1.640028,ec-3\"",
      "canPlayType": "probably",
      "mse": {
        "MediaSource": true,
        "ManagedMediaSource": true
      }
    },
    "muxed-hevc8-aac": {
      "mime": "video/mp4; codecs=\"hvc1.1.6.L93.B0,mp4a.40.2\"",
      "canPlayType": "probably",
      "mse": {
        "MediaSource": true,
        "ManagedMediaSource": true
      }
    },
    "muxed-hevc10-aac": {
      "mime": "video/mp4; codecs=\"hvc1.2.4.L93.B0,mp4a.40.2\"",
      "canPlayType": "probably",
      "mse": {
        "MediaSource": true,
        "ManagedMediaSource": true
      }
    },
    "muxed-av1-aac": {
      "mime": "video/mp4; codecs=\"av01.0.04M.08,mp4a.40.2\"",
      "canPlayType": "probably",
      "mse": {
        "MediaSource": true,
        "ManagedMediaSource": true
      }
    },
    "muxed-h264-truehd": {
      "mime": "video/mp4; codecs=\"avc1.640028,mlpa\"",
      "canPlayType": "(empty string = no)",
      "mse": {
        "MediaSource": false,
        "ManagedMediaSource": false
      }
    },
    "muxed-h264-dts": {
      "mime": "video/mp4; codecs=\"avc1.640028,dtsc\"",
      "canPlayType": "(empty string = no)",
      "mse": {
        "MediaSource": false,
        "ManagedMediaSource": false
      }
    }
  },
  "videoPlayback": {
    "h264_aac.mp4": {
      "url": "samples/h264_aac.mp4",
      "error": null,
      "frameCallbackFired": 10,
      "playbackQuality": {
        "totalVideoFrames": 2,
        "droppedVideoFrames": 0,
        "corruptedVideoFrames": 0
      },
      "readyState": 4,
      "duration": 5,
      "playError": null,
      "currentTime": 2.5991909333336842
    },
    "hevc8_aac.mp4": {
      "url": "samples/hevc8_aac.mp4",
      "error": null,
      "frameCallbackFired": 10,
      "playbackQuality": {
        "totalVideoFrames": 2,
        "droppedVideoFrames": 0,
        "corruptedVideoFrames": 0
      },
      "readyState": 4,
      "duration": 5,
      "playError": null,
      "currentTime": 2.7000749163325457
    },
    "hevc10_aac.mp4": {
      "url": "samples/hevc10_aac.mp4",
      "error": null,
      "frameCallbackFired": 10,
      "playbackQuality": {
        "totalVideoFrames": 4,
        "droppedVideoFrames": 0,
        "corruptedVideoFrames": 0
      },
      "readyState": 4,
      "duration": 5,
      "playError": null,
      "currentTime": 2.6295623516665483
    },
    "av1_aac.mp4": {
      "url": "samples/av1_aac.mp4",
      "error": null,
      "frameCallbackFired": 10,
      "playbackQuality": {
        "totalVideoFrames": 1,
        "droppedVideoFrames": 0,
        "corruptedVideoFrames": 0
      },
      "readyState": 4,
      "duration": 5,
      "playError": null,
      "currentTime": 2.64519575233251
    }
  },
  "audioDecode": {
    "h264_aac.mp4": {
      "url": "samples/h264_aac.mp4",
      "error": null,
      "decodedSeconds": 5,
      "nonSilent": true,
      "numberOfChannels": 1,
      "maxAbsSample": 0.14425046741962433
    },
    "h264_ac3.mp4": {
      "url": "samples/h264_ac3.mp4",
      "error": null,
      "decodedSeconds": 5.008979166666666,
      "nonSilent": true,
      "numberOfChannels": 1,
      "maxAbsSample": 0.12502232193946838
    },
    "h264_eac3.mp4": {
      "url": "samples/h264_eac3.mp4",
      "error": null,
      "decodedSeconds": 5.008979166666666,
      "nonSilent": true,
      "numberOfChannels": 1,
      "maxAbsSample": 0.12503814697265625
    },
    "h264_truehd.mkv": {
      "url": "samples/h264_truehd.mkv",
      "error": "null",
      "decodedSeconds": null,
      "nonSilent": null,
      "numberOfChannels": null
    },
    "h264_truehd.mp4": {
      "url": "samples/h264_truehd.mp4",
      "error": "null",
      "decodedSeconds": null,
      "nonSilent": null,
      "numberOfChannels": null
    },
    "h264_dts.mkv": {
      "url": "samples/h264_dts.mkv",
      "error": "null",
      "decodedSeconds": null,
      "nonSilent": null,
      "numberOfChannels": null
    },
    "h264_dts.mp4": {
      "url": "samples/h264_dts.mp4",
      "error": "null",
      "decodedSeconds": null,
      "nonSilent": null,
      "numberOfChannels": null
    },
    "h264_dts.mov": {
      "url": "samples/h264_dts.mov",
      "error": "null",
      "decodedSeconds": null,
      "nonSilent": null,
      "numberOfChannels": null
    }
  }
}
```
