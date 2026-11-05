# Edit and save Markdown

## Sub-features

1. `manual-save` edits the real source pane and checks preview, Save, Command-S, status, and exact disk text.
2. `encoding-preservation` checks unchanged and edited files with LF endings, CRLF endings, and an existing encoding marker.
3. `corpus-roundtrip` opens 31 disposable corpus copies and calls the save bridge unchanged. Every copy must retain identical bytes.
4. `save-navigation` checks Cancel, Save, and Discard while opening another file. Each choice must affect the right draft and file.
5. `save-failure` removes write access from a disposable file after opening, once with no write bits and once with only a group write bit. Each failed save must retain its draft. Retry writes after permissions return.
6. `outside-change` changes a disposable file externally. Save must retain the draft and outside bytes. Save copy writes a separate file. Reload requires confirmation.
7. `autosave` enables the real setting and checks the resulting disk text. The check returns autosave to off.
8. `autosave-error` forces one failed autosave. New typing must remain unsaved after permissions return, until Retry.
9. `quit-guard` requests a real window close and cancels it. The app and draft must remain open. Save then writes the draft.
10. `save-order` holds replacement of one disposable file at the filesystem call. Typing during that save must retain the newer draft. Closing waits for the save, then Cancel retains the newer draft. A second save writes it.
11. `save-navigation-pending` starts navigation during a delayed write. The first file must save before the second opens.
12. Within `outside-change`, Save copy refuses a symbolic link destination and another spelling of the original's path. Both retain the draft and the original disk bytes.

## How to get to it

Open Markdown and choose Edit. Save writes changes. Settings contains Autosave. Failed saves expose Retry, Reload, and Save copy.

## Driving it with Playwright

1. Run `scripts/verify full --feature edit-save`. It uses the corpus described in [README.md](README.md).
2. `scripts/verify-edit.mjs` exports `verifyEdit`. The driver supplies its Electron app, page, scratch folder, evidence folder, check recorder, and open helper.
3. Native open and Save copy dialogs return disposable paths through Electron's dialog boundary. The app still handles the selections and writes files.
4. Unchanged corpus saves call the existing page bridge because unchanged text may disable the Save button. Edited saves use the visible controls.
5. The module leaves a clean document and autosave off. The main driver owns app shutdown and scratch cleanup.
6. The delayed-save check substitutes `node:fs/promises.rename` only for one exact disposable destination. It restores the function after the check.

## Evidence and limits

1. Each named check records a result only after its assertions finish. Screenshots show editing and the forced write failure.
2. Native picker use stays in the manual checklist from `scripts/hand-journey`. Replacing dialog results does not prove native picker usability.
3. The read-only and outside-change fixtures are deliberate failure inputs. Tests only change disposable copies.
4. Settings across restart and final clean shutdown belong to the appearance and delivery checks.
