# Browse folders and change files

## Sub-features

1. `folder-browse` opens a disposable folder, expands nested and empty directories, and opens uppercase `.MARKDOWN`. Unsupported names remain visible.
2. `folder-errors` removes an empty disposable directory after listing it. Opening its stale entry reports an error. Refresh removes that entry.
3. `rename-collision` tries an occupied name. The source and destination retain their original contents. Source tests cover a target created during rename.
4. `file-action-guard` cancels rename and Trash with an unsaved draft. Both the draft and original file remain.
5. `rename-active-draft` saves a draft before renaming. The renamed document stays selected and accepts another save.
6. `trash-failure` forces one disposable Trash request to fail. The edited draft and original disk contents remain available.
7. `trash-real` cancels once, then uses macOS Trash. The unique item must exist in Trash with matching contents.
8. `corpus-scale` opens all 310 copied documents through sidebar clicks. It also matches all 730 direct filenames and opens the final entry.
9. `folder-selection-order` delays one folder listing, chooses another folder, then releases the old result. The new selection remains.
10. `copy-folder-selection` saves a same-named copy outside the selected folder. The app switches to that standalone file.

## User journey

1. Choose Open folder and expand a directory in the sidebar.
2. Select a Markdown file. Choose Edit to change its source beside the preview.
3. Open File actions, then choose Rename or Move to Trash.
4. Resolve unsaved changes before confirming the file action. Cancel keeps the current draft.

## Driving the real app

Run `scripts/verify full --feature files`. It uses the corpus described in [README.md](README.md). The driver opens the real Electron page.

1. The native folder picker returns disposable selections through Electron's dialog boundary. Native picker use stays in the manual checklist from `scripts/hand-journey`.
2. The failed Trash control replaces Electron's Trash function for one exact disposable path. It restores the function in all outcomes.
3. The real Trash control checks one unique filename directly. It never lists or reads other Trash items.
4. Successful verification removes only that disposable Trash item. If reading the item is denied, the check fails and records missing evidence.
5. The scale check copies the 31 source documents ten times. Original documents are only read. No direct bridge opens substitute for sidebar clicks.

## Evidence and limits

1. Screenshots cover folder browsing, the failed Trash draft, and the wide directory.
2. `logs/trash-proof.json` records source removal and content comparison separately. Source disappearance alone is insufficient evidence.
3. `traces/files-scale.json` records exact file counts and the method used to open them.
4. When the check cannot read the Trash folder, it fails for lack of permission. That does not mean the app lost the file.
