# Open and read Markdown

## Sub-features

1. Open a file, render headings, lists, tables, tasks, code, and local images. Follow a Markdown link and cancel another open.
2. Show read-only source. Compare source bytes for 31 corpus copies. Reject arbitrary document identifiers and paths outside the selected root.
3. Display embedded page code as text. Block automatic remote images and direct Node access in the page.

## How to get to it

Launch with `npm start`, choose Open file, and select Markdown. Show source adds a read-only pane.

## Driving it with Playwright

Run `scripts/verify fast --feature open-read`. The driver clicks the real page, while a native-picker stand-in selects disposable files. Results and screenshots remain in the printed evidence folder.

## Gotchas

1. The corpus check uses a generated sample, or your own `.local/planning/corpus.json`. [README.md](README.md) explains both. The driver copies the files before opening them. It never changes originals.
2. Automated results do not prove native picker use. The manual checklist from `scripts/hand-journey` covers it.
3. `scripts/verify fast --feature open-read --failure-control` deliberately requests a missing element and must exit 1. This is a broken test input, not an app defect.
