# Working on text-desk

These rules are for coding agents. Human contributors follow the same rules in [CONTRIBUTING.md](CONTRIBUTING.md).

## Read for the task

1. Read README.md for the user journeys, limits, and design.
2. Use `verify/features/README.md` and `.agents/skills/verify-text-desk/SKILL.md` to drive the real Electron app.
3. Keep working notes, scratch files, and evidence under `.local/`. Git ignores it.

## Boundaries

1. Never commit secrets, private keys, or personal data.
2. Tests change only the disposable files they create. Never use real documents for write, rename, or Trash tests.
3. Add or upgrade a dependency only with a stated reason. Pin the exact version, check that the release is at least 21 days old, and keep `package-lock.json` in step.
4. Do not install the app into Applications or register file associations from a script.

## Invariants and their checks

| # | Invariant | Named checks |
| --- | --- | --- |
| 1 | Page requests cannot escape file grants or run system code | `boundary-authority`, `markdown-inert`, `local-assets` |
| 2 | A save result refers to its original document and draft revision | `save-order`, `save-navigation`, `autosave-error` |
| 3 | Failed writes and detected outside changes keep the draft | `save-failure`, `outside-change`, `quit-guard` |
| 4 | Rename never replaces another file; deletion uses macOS Trash | `rename-collision`, `rename-case`, `trash-real`, `trash-failure` |
| 5 | Opening and unchanged saves keep the original bytes | `corpus-roundtrip`, `encoding-preservation` |
| 6 | Theme and autosave settings survive a restart | `settings-restart`, `system-theme` |
| 7 | Test cleanup stops only its own processes and keeps evidence | `harness-cleanup`, `--failure-control` |

The unit tests in `tests/` and the app checks in `scripts/verify*.mjs` use these names.

## Change and hand-off

1. For a behavior change, first add a check that fails. Then make the smallest change where the behavior lives.
2. Test visible behavior and disk results together. Screenshots alone do not prove saves, rename, or Trash.
3. Run `scripts/check fast` and the relevant `scripts/verify` feature check before you hand off.
4. Report the exact commands, exit codes, evidence folder names without their full paths, stand-ins, and native behavior that stayed untested. Do not paste evidence contents into public text.
5. Write plain English with straight quotes. Avoid long dashes and unexplained abbreviations.
6. Commit from the main folder of a clone set up as `CONTRIBUTING.md` says. The hooks check the commit, and they do not support linked worktrees.
