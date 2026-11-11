# Isolated real-service journeys

Run from the repository root after installing project dependencies and the
Playwright Chromium browser:

```sh
PREXU_JOURNEY_REPORT=/tmp/prexu-real-journeys.json node scripts/real-journeys/run.mjs
```

Supply `PREXU_QA_PLEX_AUTH` through the protected environment, never an argument
or a checked-in file. The runner discovers only **Prexu QA Test Server** and
requires rating key `2` to be **Prexu QA Pattern**. It never chooses another
server or a personal movie as a fallback. Requests use bounded timeouts and
refuse redirects. Credentials and account responses stay in memory.

The implemented browser slice checks real Plex-backed session restore,
search-to-detail identity against service metadata, and UI preference persistence
across reload. It seeds the normal browser auth store; this is explicitly not a
PIN-login test. No Plex routes or player hooks are mocked. Each invocation owns
its Vite instance and an ephemeral Chromium context, closes both in `finally`,
and does not reuse a listening server. A loopback relay override prevents
accidental connection to the server-derived relay. Browser traces, screenshots,
video, storage snapshots and console output are not saved. The JSON report
contains only fixed scenario labels, statuses and diagnostic stages, with no
service responses, account names, URLs, tokens, or raw exception messages.

This is a partial harness, not the full acceptance gate. Any FAIL, BLOCKED,
NOT_RUN or UNSUPPORTED row exits 1. Missing credentials fail before startup;
`--allow-missing-service` explicitly records SKIP and exits 0 instead. That flag
only permits the missing-credential skip, never failed requests or partial
coverage. Attach the JSON report to the tracking issue; temporary paths are not
durable evidence.

Remaining coverage is recorded in every service-backed report:

| Journey | Boundary still to implement or provision |
| --- | --- |
| Login | Desktop shell opens the real PIN flow; seeded browser auth does not prove it |
| Playback, resume, watch-state | Desktop driver, service assertions and restoration of synthetic-fixture state |
| Queue/postplay | Real playback completion and queue advancement |
| Downloads/offline | Tauri download backend is unavailable in a browser; requires desktop driver |
| Two-client relay | Second distinct authorized QA Plex account, then local production relay and two app clients |

The production relay keys connections by verified Plex username. A second
connection using the same account supersedes the first, so it cannot represent
a guest. The provisioning request asks for a second QA identity with access to
the QA server, bound as `PREXU_QA_PLEX_GUEST_AUTH`. The current runner does not
consume that variable or start a relay yet. Test-mode relay authentication is
not equivalent to this real-account acceptance. Product changes under
prexu-5n1 and prexu-9f4s are outside this harness's scope.

Run the credential-gate checks without service access:

```sh
node --test scripts/real-journeys/run.test.mjs
```
