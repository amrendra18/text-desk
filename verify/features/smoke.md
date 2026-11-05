# Small reading journey

1. `scripts/verify fast` creates disposable Markdown, a linked note, and a local image. It opens the development app with an isolated profile.
2. The check verifies headings, tables, tasks, code, source, local images, links, and cancellation. Deliberate embedded script text remains inert.
3. Heading names cannot replace app controls. `heading-anchors` gives repeated headings unique anchors. `reload-guard` proves the menus offer no reload or developer tools, and that an unsaved draft survives. Invalid anchors show a notice. Invalid document identifiers are refused.
4. `notice-retry` fails one open on purpose. A later notice must not keep the Retry button of that failed open.
5. `read-only-after-edit` opens a writable note in Edit, then opens a read-only note. Edit must be unavailable and the source must stay read-only.
6. `reading-width` opens long lines, a long code block, and a wide table at several window widths. Read view text must fill the pane at every width, with no reading-width limit. Code and wide tables scroll inside their blocks, table words never split in the middle, images in tables keep a readable size, and the page never scrolls sideways. `traces/reading-width.json` holds window, pane, text, and characters per line, and each row names its screenshot.
7. The driver records runtime measurements and confirms normal quit stops its app process. Cleanup leaves a separate control process alive.
8. `--packaged` selects the local bundle. Bundle checksums must match the compiled source. No corpus manifest is needed for this small journey.
9. Native picker results are substituted through Electron's dialog boundary. Real picker use stays in the manual checklist.
