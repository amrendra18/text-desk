import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(__dirname, '../..');
const binary = path.join(root, 'bin/text-desk');
const version = (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version;
const bundle = path.join(root, '.local/package/text-desk.app/Contents/MacOS/text-desk');
function call(args: string[]) {
  const state = mkdtempSync(path.join(tmpdir(), 'text-desk-cli-test-'));
  try {
    return spawnSync(binary, args, { cwd: tmpdir(), encoding: 'utf8', env: { ...process.env, TEXT_DESK_STATE_DIR: state } });
  } finally { rmSync(state, { recursive: true, force: true }); }
}
test('help and version read no app state', () => {
  const help = call(['open', '--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Effects: reads, window, process, writes own state/);
  const printed = call(['--version']);
  assert.equal(printed.status, 0);
  assert.ok(printed.stdout.includes(version));
});
test('bad calls print one JSON error object', () => {
  for (const args of [['no-such-verb', '--format', 'json'], ['open', '--no-such-flag', '--format', 'json'], ['open', '--format', 'json']]) {
    const result = call(args);
    assert.equal(result.status, 2);
    const value = JSON.parse(result.stdout);
    assert.equal(typeof value.error.code, 'string');
    assert.equal(typeof value.error.message, 'string');
    assert(Array.isArray(value.error.next));
    assert.equal(result.stdout.trim().split('\n').length, 1);
  }
});
test('missing path does not start app', () => {
  const result = call(['open', '/no-such-text-desk-test.md', '--format', 'json']);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, 'path-missing');
  assert.equal(result.stderr, '');
});
test('plain-text errors state the message once', () => {
  const result = call(['open', '/no-such-text-desk-test.md']);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '/no-such-text-desk-test.md does not exist.\n');
});
test('open help works with a path before the flag', () => {
  const result = call(['open', 'README.md', '--help']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, call(['open', '--help']).stdout);
});
test('the documented symlink finds the launcher', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'text-desk-install-test-'));
  try {
    const link = path.join(folder, 'text-desk');
    symlinkSync(binary, link);
    const result = spawnSync(link, ['--version'], { cwd: folder, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes(version));
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
test('a file cannot be used as the app state folder', { skip: existsSync(bundle) ? false : 'needs the app bundle from npm run package' }, () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'text-desk-state-test-'));
  try {
    const note = path.join(folder, 'note.md');
    const stateFile = path.join(folder, 'state');
    writeFileSync(note, '# note\n'); writeFileSync(stateFile, 'blocked');
    const result = spawnSync(binary, ['open', note, '--format', 'json'], { cwd: folder, encoding: 'utf8', env: { ...process.env, TEXT_DESK_STATE_DIR: stateFile } });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).error.code, 'bad-state');
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
