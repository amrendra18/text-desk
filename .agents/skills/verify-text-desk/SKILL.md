---
name: verify-text-desk
description: Drive the real text-desk Electron app with isolated files and capture evidence for its mapped user journeys.
---

# Verify text-desk

## Launch

1. From the repository, run `npm ci --ignore-scripts`, `npm run setup`, and `npm run build`.
2. Run `scripts/verify fast`. The command starts its own Electron process with a private profile. It is ready when Open file appears.
3. `npm start` opens the development app for manual use. Command-Q quits it.

## Doctor

The command checks the runtime, compiled entry, and a local socket before launching. Every feature except smoke and cli-open also uses the corpus described in `verify/features/README.md`: a generated sample, or your own manifest. Exit 3 means the environment is unavailable and no app started. Evidence includes the doctor output.

## Drive

1. The command uses Playwright's Electron driver. It clicks `#open-file`, `#raw-view`, and rendered links, then reads `#preview` and `#editor`.
2. Native open dialogs return disposable fixture selections through Electron's dialog boundary. No production test endpoint exists.
3. The map in `verify/features/README.md` owns the available journeys. Use `scripts/verify --help` for flags and exit codes.

## Measure

The command records launch duration and Electron process memory in `traces/runtime.json`. Playwright records actions and page snapshots in `traces/app-1.zip` and a separate trace for each restart. A screenshot alone proves no timing claim.

## Evidence

1. `.local/verify/` contains each run's summaries, gallery, screenshots, trace, and logs. A cli-open run writes only `summary.json`, `launch.json`, and one screenshot. The command prints the exact folder last.
2. Compare page source with real file contents. The corpus holds 31 Markdown inputs. The driver copies them before use and never changes the originals.
3. Every summary except cli-open's declares picker substitutions and the remaining native interaction check. The cli-open check uses no picker. Exit 0 proves selected mapped features only.
4. `--failure-control` uses an intentionally missing element. Expect exit 1 naming the selected feature and preserved evidence.

## Cleanup

The command closes only the Electron process it launched and removes its own scratch files. A separate temporary process proves cleanup leaves unrelated processes alive. Evidence is kept, including after a failure.

## Helpers

`scripts/verify` calls `node scripts/verify.mjs`. `scripts/check full` builds, runs source tests and policy checks, and checks package advisories. Both scripts can run from outside the repository.
