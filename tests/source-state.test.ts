import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(__dirname, '../..');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));

async function preparedWithoutGit(parent: string) {
  await mkdir(parent, { recursive: true });
  const copy = await mkdtemp(path.join(parent, 'text-desk-no-git-'));
  try {
    await mkdir(path.join(copy, 'scripts'));
    for (const name of ['hand-journey', 'source-state.mjs']) await copyFile(path.join(root, 'scripts', name), path.join(copy, 'scripts', name));
    const run = spawnSync(process.execPath, [path.join(copy, 'scripts/hand-journey'), '--prepare'], { cwd: copy, encoding: 'utf8', env });
    assert.equal(run.status, 0, run.stderr);
    const folder = path.join(copy, '.local/hand-journey');
    const [journey] = await readdir(folder);
    const evidence = JSON.parse(await readFile(path.join(folder, journey!, 'observations.json'), 'utf8'));
    assert.equal(evidence.sourceCommit, '');
    assert.match(await readFile(path.join(folder, journey!, 'instructions.md'), 'utf8'), /Source commit: unknown \(no Git history\)/);
  } finally { await rm(copy, { recursive: true, force: true }); }
}

test('no-git hand-journey prepares its steps in a folder outside any repository', async () => {
  await preparedWithoutGit(os.tmpdir());
});

test('no-git hand-journey ignores the Git history of a parent folder', async () => {
  await preparedWithoutGit(path.join(root, '.local'));
});

test('no-git source state reports an unknown commit and no listed changes', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'text-desk-no-git-'));
  try {
    const { sourceState } = await import(pathToFileURL(path.join(root, 'scripts/source-state.mjs')).href);
    assert.deepEqual(sourceState(folder), { commit: '', dirtyFiles: [] });
  } finally { await rm(folder, { recursive: true, force: true }); }
});

const wrongCaseRoot = root.toUpperCase();
const wrongCaseSkip = !existsSync(path.join(root, '.git')) ? 'needs a Git checkout' : !existsSync(wrongCaseRoot) ? 'needs a case-insensitive disk' : false;
test('source state finds the commit through a wrong-case path', { skip: wrongCaseSkip }, async () => {
  const { sourceState } = await import(pathToFileURL(path.join(root, 'scripts/source-state.mjs')).href);
  const expected = sourceState(root);
  assert.notEqual(expected.commit, '');
  assert.deepEqual(sourceState(wrongCaseRoot), expected);
});

test('no-git packaging reads its source state through the shared helper', async () => {
  const script = await readFile(path.join(root, 'scripts/package.mjs'), 'utf8');
  assert.match(script, /sourceState\(root\)/);
  assert.doesNotMatch(script, /command\('git'/);
});
