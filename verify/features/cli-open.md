# Command open

1. Reach it with `text-desk open /absolute/path/to/note.md --format json` after packaging the app.
2. The command opens that file in the window, prints one object, and returns while the app remains open.
3. A later request goes to the running app and uses the Save, Discard, Cancel guard for an unsaved draft.
4. `scripts/verify full --feature cli-open --packaged` uses disposable files. It checks the visible filename and heading, the detached command, and the resulting app process. This check needs `--packaged`. Without it, `scripts/verify` exits 2 and runs nothing.
