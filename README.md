![text-desk: Open a note. Read it. Edit it.](.github/banner.svg)

# text-desk

text-desk is a small Markdown reader and editor for macOS. Open an existing note or folder, read a clean preview, and edit the source beside it. Files stay where they are. There is no account, server, or telemetry.

```sh
git clone https://github.com/amrendra18/text-desk.git && cd text-desk
npm ci --ignore-scripts && npm start
```

text-desk is provided as is, without warranty; see [LICENSE](LICENSE).

## Contents

1. [Requirements](#requirements)
2. [Install and run](#install-and-run)
3. [What install writes](#what-install-writes)
4. [Network use](#network-use)
5. [Use the app](#use-the-app)
6. [File limits](#file-limits)
7. [How it works](#how-it-works)
8. [Remove](#remove)
9. [Run the checks](#run-the-checks)
10. [Contributing and security](#contributing-and-security)
11. [License and credits](#license-and-credits)

## Requirements

1. Runs on macOS only, for now. It needs an Apple silicon Mac with macOS 13 or later.
2. Node.js 24.20.0 or a later 24.x release.
3. Git to get the code, and the `curl`, `tar`, `ditto`, `codesign`, and `plutil` tools that ship with macOS.
4. An internet connection for the first setup. It downloads Electron once.

## Install and run

Run these commands from the repository folder. The last command confirms that `text-desk` is on your command search path.

```sh
npm ci --ignore-scripts
npm run setup
npm run package
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/bin/text-desk" "$HOME/.local/bin/text-desk"
export PATH="$HOME/.local/bin:$PATH"
text-desk --version
```

1. `npm ci --ignore-scripts` installs the locked packages without running their install scripts.
2. `npm run setup` downloads Electron 44.5.0 from its official release. It checks pinned SHA-256 hashes before it unpacks anything into `.local/electron/`.
3. `npm run package` builds the local app bundle. The link in `~/.local/bin` exposes one command. The `export` line adds that folder to your command search path for this terminal only. Add it to your shell profile to keep it.
4. `text-desk open /absolute/path/to/note.md` opens a file. A folder path opens its sidebar. The command returns after the window opens and leaves the app running. Command-Q quits it.
5. `TEXT_DESK_STATE_DIR` overrides the default state folder, `~/Library/Application Support/text-desk/`. Separate state folders start separate app instances.

To open the packaged app without the command:

```sh
open .local/package/text-desk.app
```

1. Packaging creates `.local/package/text-desk.app` with an ad-hoc signature. It is not notarized, and it is not installed into Applications.
2. To reopen the bundle later, run only the `open` command. After source changes, run `npm run package` again.
3. Packaging also works in a download without a `.git` folder. It then records no source commit, so `text-desk --version --format json` reports an empty revision.

A script or coding agent can run `text-desk open /absolute/path/to/note.md --format json`. The command prints one JSON object.

## What install writes

1. `npm ci` writes `node_modules/` in this checkout. Setup writes `.local/electron/`; packaging writes `.local/package/`. The link writes `~/.local/bin/text-desk` only when you run its line.
2. The app writes settings, caches, and Electron's logs in `~/Library/Application Support/text-desk/`, or in `TEXT_DESK_STATE_DIR` when set. Those logs can name your home folder. For the packaged app, macOS records the last folder you picked in `~/Library/Preferences/local.textdesk.app.plist`. Under `npm start`, it may keep that record under `com.github.Electron`, which other Electron apps share.
3. The app writes a document only after you choose Save, Rename, or Move to Trash in the window.

## Network use

1. `npm ci` and the first `npm run setup` download packages and Electron. `scripts/check full` runs `npm audit` against the npm registry.
2. The app makes no automatic network requests. A web link opens in your browser only after you click it. Remote images do not load.

## Use the app

| # | Action | Result | Recovery |
| --- | --- | --- | --- |
| 1 | Choose Open file | A native picker opens. Markdown appears. Show source adds read-only text. | Cancel keeps the current document. Missing or unreadable files show an explanation. |
| 2 | Choose Open folder and expand directories | The left pane lists all names. Only `.md` and `.markdown` files open, in any letter case. | Refresh reloads folder entries. Empty, unavailable, and unsupported entries explain their state. |
| 3 | Choose Edit | The preview stays left and editable source stays right. Typing updates the preview. | Leaving, closing, or quitting with changes offers Save, Discard, and Cancel. |
| 4 | Choose Save or press Command-S | Saved appears after the disk write completes. | Errors keep the draft. Retry tries another save. Outside changes offer Reload or Save copy. |
| 5 | Turn on Autosave in Settings | The app saves after typing stops. Autosave starts off. | Errors pause autosave until Retry. The draft stays visible. |
| 6 | Open File actions and choose Rename or Move to Trash | Rename changes the filename. Trash asks for confirmation. | A name collision keeps both files. Failed actions keep the current draft. |
| 7 | Choose Theme in Settings | Ember, Graphite, Midnight, Plum, Paper, and System apply and persist. | System follows the Mac appearance. Damaged settings fall back to defaults and show a notice. |

1. Ember is the default charcoal and orange theme. Paper is light. System picks Ember or Paper.
2. The preview supports headings, lists, tables, task lists, fenced code, local images, and links. HTML inside a note appears as plain text.
3. An open folder allows images and Markdown links inside that folder. A single open file allows its own folder.
4. Paths outside that folder need an explicit pick. Web links open in your browser only after a click. Remote images never load.
5. After a restart, the app opens empty with your saved settings. Handled errors keep unsaved drafts. A crash can lose them. A crash during a save can also leave a hidden `.text-desk-*.tmp` file holding your text beside the original, and you can delete that file.
6. Save copy opens the copy as a separate document, so the sidebar names the copy correctly.
7. Only one copy of the app runs. Opening it again brings the existing window to the front.

## File limits

1. Files stay in their current folders. The app reads UTF-8 text and refuses other encodings without changing the file.
2. Saving keeps the original line endings, file permissions, an existing byte-order mark, the creation date, and extended attributes such as Finder tags. On a disk that cannot copy those attributes, the save still completes without them. A changed save does not keep an access control list or the Finder hidden flag. An unchanged file with mixed line endings keeps its exact bytes.
3. Editing a file with mixed line endings needs Save copy. Copies to a new file use UTF-8 with LF line endings. A copy over an existing file keeps that file's line endings. A link or the original file as the copy destination is refused.
4. Read-only files and files with more than one hard link open read-only, and Edit is unavailable. Save, Rename, and Move to Trash also refuse a file that your user cannot write. Symbolic links stay visible in the sidebar.
5. Before replacing a file, a save checks for outside changes. Exact coordination with another program writing at the same instant is not guaranteed.
6. Not supported yet: plain text and config files, creating new files, tabs, cloud sync, diagrams, math, folder rename or deletion, and other operating systems.
7. The app adds no account, service, telemetry, automatic update, or default file association.

## How it works

1. Electron's main process owns file access, native pickers, and settings. A sandboxed page process renders the preview and holds one draft.
2. A small bridge exposes named operations and opaque file identifiers. The page has no general file or system-command access.
3. TypeScript compiles the app. [marked](https://github.com/markedjs/marked) 18.0.14 turns Markdown into HTML. The page then keeps only allowed elements and local resource paths.
4. Saves for one file run one at a time. Each save copies the original with its attributes to a temporary file beside it, writes your text there, and then replaces the original. A late save result never replaces newer typing.
5. Settings live in a versioned file in the app's macOS data folder. The app writes no document text to logs.
6. Dependencies are few and pinned to exact versions.

## Remove

1. Quit the app with Command-Q. Remove the `~/.local/bin/text-desk` link and this checkout if you no longer need them.
2. Remove `~/Library/Application Support/text-desk/` only if you want to delete its settings and caches.
3. If you ran the packaged app, run `defaults delete local.textdesk.app` to delete the record of the last folder you picked.
4. Your Markdown files remain in their original folders.

## Run the checks

Run setup first, so the Electron type file exists. Then run:

```sh
scripts/check fast
scripts/verify fast
```

1. `scripts/check fast` builds the source, runs the unit tests, and checks source rules, locked package integrity, and the command's help and error output.
2. `scripts/check full` also runs `npm audit` and writes the result to `.local/dependencies/audit.json`. It needs the network.
3. `scripts/verify fast` drives the real app with Playwright. It creates its own example files and uses a separate settings profile. It checks reading, source view, local images, inert HTML, read-only files, that the menus cannot reload away a draft, and normal quit.
4. Add `--packaged` to check the bundle from `npm run package` instead of the development app.
5. Each run keeps its evidence in `.local/verify/` and prints the folder last. Exit 0 means every selected check worked. Exit 1 means a check failed. Exit 2 means invalid arguments. Exit 3 means the app could not start, so no check ran.
6. Native pickers and the Mac appearance are replaced by controlled stand-ins during these runs. `scripts/hand-journey` prints a manual checklist for those parts and records what you observe. `scripts/hand-journey --prepare` prints the steps without asking for input.

The other feature checks (`scripts/verify full` and `--feature open-read`, `edit-save`, `files`, or `appearance`) also read 31 Markdown files. They build a sample set in a scratch folder and delete it after the run. The `files` check moves one disposable file to your real Trash, reads it there, and deletes it. To use your own files instead, follow [verify/features/README.md](verify/features/README.md), which lists every check.

## Contributing and security

1. [CONTRIBUTING.md](CONTRIBUTING.md) explains setup, checks, and change rules.
2. [SECURITY.md](SECURITY.md) explains how to report a security problem privately.
3. [AGENTS.md](AGENTS.md) holds the same rules for coding agents.

## License and credits

text-desk is released under the MIT License. See [LICENSE](LICENSE).

1. [Electron](https://www.electronjs.org/) runs the app. It is MIT licensed.
2. [marked](https://github.com/markedjs/marked) parses Markdown. It is MIT licensed. The build copies its file, with its copyright notice, into the app.
