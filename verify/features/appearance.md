# Appearance and delivery checks

1. Run `scripts/verify full --feature appearance --packaged` after `npm run package`. It uses the corpus described in [README.md](README.md). The main driver owns launch, restart, and cleanup.
2. `scripts/verify-appearance.mjs` drives the real app through the main driver's page and native picker stand-in.
3. This module has no app launch command. The main driver supplies `restart()`, which reuses the profile and returns the new app and page.

| # | Check | Evidence and required result |
| --- | --- | --- |
| 1 | `theme-layout` | Select all six themes at 1280 by 800 and 1000 by 700 content pixels. Record actual dimensions and palette values. Settings and file controls remain inside the window. Each theme permits typing, preview updates, and a matching disk save. Keep Settings and editor screenshots for all 12 combinations. |
| 2 | `system-theme` | Browser media emulation changes System from Ember in dark appearance to Paper in light appearance. The stored choice remains System. Keep both screenshots. |
| 3 | `settings-restart` | Store Plum and enabled autosave. Restart with the same profile. The empty screen uses Plum, Settings retain both choices, and no document returns. Disable autosave afterward. |
| 4 | `keyboard-journeys` | Tab reaches Settings, Enter opens it, an arrow changes the selected theme, and Escape closes it. Command-S writes the edited disposable file. |
| 5 | `large-document` | Generate exactly 1229310 bytes. Observe Loading, open the preview, and edit the source. The final heading appears and saved bytes match the draft. Record input size, open-to-preview time, and edit-to-preview time. The check sets no time limit. |
| 6 | `no-network` | Start a loopback observer. One direct Node request proves the observer works. Render a remote image and unclicked link pointing to it. The app makes zero requests during rendering and the next 300 milliseconds. Close the observer afterward. |

## Evidence and limits

1. `traces/appearance.json` holds dimensions, palette values, timings, restart results, keyboard results, network counts, and stand-ins. It is written even if a check fails.
2. The large-file edit timer includes driver input delivery and preview rendering. It is not a parser-only measurement.
3. The loopback observation proves the tested resource behavior. It does not establish that every possible input can never cause a request.
4. Native picker use, real Mac appearance changes, and physical keyboard use stay in the manual checklist from `scripts/hand-journey`.
5. The main driver records launch time, memory, packaged launch, and shutdown.
6. Damaged settings have main-process unit coverage. This check does not damage a real settings file.
