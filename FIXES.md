# Fixes & Improvements

Issues and ideas found during testing. Check items off as they're addressed.

---

- [x] **Auto-update: periodic check while app is running** — Added a 15-minute periodic re-check in `useAutoUpdate` so users who leave the app open still get notified of new versions.

- [ ] **Persist library filters across views and restarts** — Filter selections (genre, year, rating, resolution, unwatched) reset when navigating away from the library and back, or when the app restarts/updates. Should remember the last-used filters per library section.

- [x] **Watch Together playback is non-functional** — Fixed: player `initPlayback` early returns now properly clear the loading state and show error messages instead of leaving a blank page. Added a back button to the loading overlay so users are never trapped. Wrapped the Player route in an ErrorBoundary to catch render crashes. Fixed `useSyncDriftDetection` performance bug (interval was being recreated on every time update). Root cause of original blank page still needs testing — the underlying player logic is identical for Watch Together and normal playback, so the video should now load correctly with proper error feedback if it doesn't.

- [x] **Invite notification volume control** — Added a volume slider (0–100%) in the Watch Together settings section. Defaults to 50% (was hardcoded at 20%). Persisted via `tauri-plugin-store`.

- [x] **Custom invite notification sounds** — Added 5 built-in sounds (Chime, Bell, Pop, Ping, Soft) selectable from the Watch Together settings. Users can also pick a custom audio file via file browser — the file is stored as a base64 data URL in `tauri-plugin-store` for persistence. Clicking a built-in sound previews it immediately.

- [x] **TV Show library grid renders with gaps after navigating back** — Reproduced by: TV Shows → open "8 Out of 10 Cats Does Countdown" → enter a season → navigate back to the TV Shows library. The grid re-renders with empty gaps in the second row (between "24" and "30 Rock"), as if items are missing or have invisible placeholders. Likely a stale state or key-reconciliation issue when the library re-mounts.
  <!-- TODO: add screenshot once saved to repo (e.g. docs/screenshots/tv-library-grid-bug.png) -->
