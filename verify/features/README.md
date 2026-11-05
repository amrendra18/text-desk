# Verification features

| # | Feature | Guide | Command |
| --- | --- | --- | --- |
| 1 | Small reading journey | [smoke.md](smoke.md) | `scripts/verify fast` |
| 2 | Open and read the corpus | [open-read.md](open-read.md) | `scripts/verify fast --feature open-read` |
| 3 | Edit and save Markdown | [edit-save.md](edit-save.md) | `scripts/verify full --feature edit-save` |
| 4 | Folder browsing and file actions | [files.md](files.md) | `scripts/verify full --feature files` |
| 5 | Themes and delivery | [appearance.md](appearance.md) | `scripts/verify full --feature appearance --packaged` |
| 6 | Open a file from the command | [cli-open.md](cli-open.md) | `scripts/verify full --feature cli-open --packaged` |

1. `scripts/verify full` checks journeys 1 to 5 in the packaged app. Build it with `npm run package` first. Journey 6 runs only with its own command.
2. The smoke check creates its own examples and needs nothing else.
3. The command-open check also creates its own examples. It checks the packaged app and a detached command. Without `--packaged`, it exits 2.
4. Native picker use, real Mac appearance changes, and physical keyboard use stay in the manual checklist from `scripts/hand-journey`.
5. The files check moves one disposable file to your real Trash, reads it there, and deletes it. It fails if macOS denies your terminal access to the Trash folder.

## Corpus

Every check except smoke and command-open reads 31 Markdown files, called the corpus.

With no manifest, the driver writes a sample of 31 short notes into its scratch folder and deletes them after the run. The run's `summary.json` says so under `stand_ins`.

## Corpus manifest

To test with your own Markdown files, create `.local/planning/corpus.json`. Git ignores this file. When it exists, the checks use it in place of the sample.

1. List exactly 31 files. The checks count them and stop on any other number.
2. Use UTF-8 Markdown files with LF line endings and no byte-order mark.
3. Use absolute paths. The checks only read these files. They copy each one into a scratch folder before opening it.

The format is:

```json
{
  "sources": [
    { "files": [{ "path": "/absolute/path/to/note-1.md" }, { "path": "/absolute/path/to/note-2.md" }] }
  ]
}
```

The `sources` groups only organize the list. The checks join all groups into one list of 31 files.
