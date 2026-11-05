# Contributing

Thank you for helping. This file explains how to set up the project, run the checks, and send a change.

## Set up

You need an Apple silicon Mac with macOS 13 or later, Node.js 24.20.0 or a later 24.x release, and Git.

```sh
npm ci --ignore-scripts
npm run setup
```

`npm run setup` downloads Electron once into `.local/electron/` and checks its pinned hashes.

## Repository hooks

Commits and pushes run pre-commit hooks. They run the `first-commit` command on your PATH. Install [first-commit](https://github.com/amrendra18/first-commit) with its `setup` extra, which brings pre-commit, as its README shows. Then run this once in each clone:

```sh
first-commit setup
```

1. It sets this clone's Git identity and SSH signing, turns on the `.gitmessage` commit template, and installs the Gitleaks scanner and the Git hooks. It does not change files this project owns.
2. In a terminal, it asks for your public identity once per machine.
3. On each commit, the hooks scan the staged files for secrets and private data, and refuse a message that does not follow `.gitmessage`. On each push, they check the commits you are pushing.
4. Commit from the main folder of your clone. first-commit does not support linked worktrees.

Check this clone with `first-commit check`. It reads `.repo-policy.json`, which lists the public email addresses and exact lines its privacy scan accepts.

## Run the checks

Run both checks before you open a pull request:

```sh
scripts/check fast
scripts/verify fast
```

1. `scripts/check fast` builds the source, runs the unit tests in `tests/`, and checks source rules and locked package integrity. It must exit 0.
2. `scripts/verify fast` opens the real app with Playwright and checks the reading journey. It must exit 0. It prints its evidence folder under `.local/verify/` last.
3. `scripts/check full` also runs `npm audit`. Run it when you change dependencies.
4. `node scripts/contract-probes.mjs --fresh-install` installs and packages a fresh clone, with and without its `.git` folder. It needs the network. Run it when you change setup or packaging.
5. The larger app checks build a sample of 31 Markdown files in a scratch folder. You can list your own files instead. [verify/features/README.md](verify/features/README.md) explains them. Run the feature check that matches your change.
6. Native pickers and the Mac appearance cannot be automated here. For a change that touches them, run `scripts/hand-journey` and describe what you saw.

## Send a change

1. Keep each pull request to one purpose.
2. For a behavior change, add a check that fails without your change.
3. Tests may change only the disposable files they create. Never point a test at real documents.
4. A check for save, rename, or Trash reads the disk as well as the screen. Screenshots alone do not prove those results.
5. Pin any new dependency to an exact version, explain why it is needed, and update `package-lock.json`. Use only a release that is at least 21 days old.
6. Write plain English in docs and messages, with straight quotes.
7. In the pull request, list the commands you ran and their exit codes. Name an evidence folder by its last part only. Do not paste its contents or its full path: they can hold your home folder path, note text, and screenshots.
8. Do not install the app into Applications or register file associations from a script.

Coding agents follow the same rules in [AGENTS.md](AGENTS.md).

## License

By contributing, you agree that your work is released under the [MIT License](LICENSE).
