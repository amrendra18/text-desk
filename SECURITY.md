# Security

## Report a problem privately

Please do not report a security problem in a public issue.

1. Open the repository on GitHub and choose the Security tab.
2. Choose "Report a vulnerability". This opens a private report that only the maintainer can read.
3. Describe the problem, the steps to reproduce it, and the macOS and text-desk versions you used.

You will get a reply in that private report. The fix and a public note follow once a correction is ready.

## Supported versions

Only the latest commit on the `main` branch gets security fixes.

## What counts

text-desk opens local files that you pick. Examples of security problems:

1. A Markdown file that runs code, loads a remote resource, or reaches the system without a click.
2. A way for the page to read, write, rename, or trash a file outside the file or folder you picked.
3. A save, rename, or Trash action that loses or replaces another file.
