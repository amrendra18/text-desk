import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, lstat, mkdir, readFile, realpath, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const executable = path.join(root, '.local/package/text-desk.app/Contents/MacOS/text-desk');
const command = path.join(root, 'bin/text-desk');
const state = process.env.TEXT_DESK_STATE_DIR || path.join(homedir(), 'Library/Application Support/text-desk');
const valid = '--format, --help';
const usage = `Open Markdown files or folders in text-desk.
Usage: text-desk open PATH [--format json]
       text-desk help [--format json]
       text-desk --version [--format json]
       text-desk --help
       text-desk open --help
Verbs: open, help
open inputs: PATH is a file ending in .md or .markdown, or a folder. It may be absolute. Success always prints one JSON object. --format json also prints errors that way. TEXT_DESK_STATE_DIR overrides the app state folder (~/Library/Application Support/text-desk).
open outputs: the absolute path, kind, and started or running. The app remains open; Command-Q quits it. Save, Rename, and Move to Trash inside the window are your later actions.
open preconditions: the packaged app exists; PATH is readable.
Effects: reads, window, process, writes own state
Exit codes: 0 window ready; 1 could not open; 2 bad call.

help inputs: optional --format json. Reads no app state.
help outputs: help text, or one JSON object with the available verbs.
help preconditions: none.
Effects: reads
Exit codes: 0 help shown; 2 bad call.
`;
const openHelp = `Open a Markdown file or folder in text-desk.
Usage: text-desk open PATH [--format json]
Inputs: PATH is a file ending in .md or .markdown, or a folder. It may be absolute. Success always prints one JSON object. --format json also prints errors that way. TEXT_DESK_STATE_DIR overrides the app state folder (~/Library/Application Support/text-desk).
Outputs: the absolute path, kind, and started or running. The app remains open; Command-Q quits it. Save, Rename, and Move to Trash inside the window are your later actions.
Preconditions: a packaged app exists at ${executable}; PATH is readable.
Effects: reads, window, process, writes own state
Exit codes: 0 window ready; 1 could not open; 2 bad call.
`;
const helpHelp = `Show text-desk command help.
Usage: text-desk help [--format json]
Inputs: optional --format json. Reads no app state.
Outputs: help text, or one JSON object with the available verbs.
Preconditions: none.
Effects: reads
Exit codes: 0 help shown; 2 bad call.
`;
type ErrorValue = { error: { code: string; message: string; next: string[] } };
function finish(code: number, value: object, json: boolean): never {
  if (json) process.stdout.write(JSON.stringify(value) + '\n');
  else if ('error' in value) {
    const error = (value as ErrorValue).error;
    process.stderr.write(`${error.message}\n${error.next[0] ? `fix: ${error.next[0]}\n` : ''}`);
  } else process.stdout.write(JSON.stringify(value) + '\n');
  process.exit(code);
}
function bad(message: string, json: boolean): never {
  return finish(2, { error: { code: 'bad-call', message, next: [`${command} --help`] } }, json);
}
function fail(code: string, message: string, next: string[], json: boolean): never {
  return finish(1, { error: { code, message, next } }, json);
}
function formatOf(args: string[]): boolean {
  return args.includes('--format') && args[args.indexOf('--format') + 1] === 'json';
}
async function packagedBuild() {
  try { return JSON.parse(await readFile(path.join(root, '.local/package/build.json'), 'utf8')) as { sourceCommit: string; dirtyFiles: string[] }; }
  catch { return null; }
}
async function main() {
  const args = process.argv.slice(2);
  const json = formatOf(args);
  if (args[0] === '--version') {
    if (args.length > 1 && !(args.length === 3 && args[1] === '--format' && args[2] === 'json')) bad('Valid flags for --version: --format json.', json);
    const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { version: string };
    const build = await packagedBuild();
    const revision = build?.sourceCommit ?? ''; const modified = (build?.dirtyFiles.length ?? 0) > 0;
    if (!json) { process.stdout.write(`text-desk ${metadata.version}\n`); return; }
    return finish(0, { version: metadata.version, revision, modified }, true);
  }
  if (args[0] === '--help' && args.length === 1) { process.stdout.write(usage); return; }
  if (args[0] === 'help') {
    if (args.length === 2 && args[1] === '--help') { process.stdout.write(helpHelp); return; }
    if (args.length === 1) { process.stdout.write(usage); return; }
    if (args.length === 3 && args[1] === '--format' && args[2] === 'json') return finish(0, { verbs: ['help', 'open'] }, true);
    bad(`Valid flags for help: ${valid}.`, json);
  }
  if (args[0] !== 'open') bad(`Unknown verb ${args[0] || '(none)'}. Valid verbs: open, help. Valid flags: --help, --version.`, json);
  if (args.includes('--help')) { process.stdout.write(openHelp); return; }
  const operands: string[] = [];
  for (let index = 1; index < args.length; index++) {
    const item = args[index]!;
    if (item === '--format') {
      if (args[++index] !== 'json') bad(`Valid flags for open: ${valid}. --format needs json.`, json);
    } else if (item.startsWith('-')) bad(`Unknown flag ${item}. Valid flags for open: ${valid}.`, json);
    else operands.push(item);
  }
  if (operands.length !== 1) bad('open needs one PATH. Valid flags: --format, --help.', json);
  const input = path.resolve(operands[0]!);
  let canonical: string;
  let kind: 'file' | 'folder';
  try {
    canonical = await realpath(input);
    const entry = await lstat(canonical);
    kind = entry.isDirectory() ? 'folder' : 'file';
    if (kind === 'file' && !/\.(md|markdown)$/i.test(canonical)) fail('not-markdown', `${input} is not a Markdown file.`, [], json);
    if (kind === 'file' && !entry.isFile()) fail('not-readable', `${input} is not a regular file.`, [], json);
    await access(canonical);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail('path-missing', `${input} does not exist.`, [], json);
    fail('not-readable', `${input} cannot be read.`, [], json);
  }
  try { await access(executable); }
  catch { fail('not-built', `The app bundle is missing at ${executable}. Run npm run package in ${root} first.`, [], json); }
  try {
    await mkdir(state, { recursive: true });
    if (!(await stat(state)).isDirectory()) throw new Error('not a folder');
  } catch { fail('bad-state', `${state} is not a usable app state folder.`, [], json); }
  const replyId = randomUUID();
  const replyFile = path.join(state, '.cli-replies', `${replyId}.json`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [`--open=${canonical}`, `--profile=${state}`, `--reply-id=${replyId}`], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env });
  let buffer = '';
  const reply = await new Promise<{ window?: 'started' | 'running'; error?: { code: string; message: string } }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The app did not become ready within 10 seconds.')), 10000);
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`The app exited before its window opened (${code}).`)));
    child.stdout.on('data', data => {
      buffer += String(data);
      for (const line of buffer.split('\n').slice(0, -1)) {
        if (line.startsWith('TEXT_DESK_READY:')) {
          clearTimeout(timer);
          try { resolve(JSON.parse(line.slice(16))); } catch (error) { reject(error); }
          return;
        }
      }
      buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
    });
    child.stderr.on('data', data => process.stderr.write(data));
  }).catch(error => { child.kill(); fail('launch-failed', String(error), [], json); });
  child.stdout.destroy(); child.stderr.destroy();
  await unlink(replyFile).catch(() => {});
  if (reply.error) {
    child.kill('SIGKILL');
    if (child.exitCode === null && child.signalCode === null) await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 2000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    fail(reply.error.code, reply.error.message, [], json);
  }
  child.unref();
  return finish(0, { opened: canonical, kind, window: reply.window, ...(reply.window === 'started' ? { pid: child.pid } : {}) }, json);
}
void main().catch(error => fail('launch-failed', String(error), [], formatOf(process.argv.slice(2))));
