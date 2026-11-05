import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, link, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Documents } from '../src/main/documents.js';
import { Folders } from '../src/main/folders.js';
import { FileActions } from '../src/main/actions.js';

async function fixture(run: (root: string, docs: Documents) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'text-desk-folders-')));
  try { await run(root, new Documents()); } finally { await rm(root, { recursive: true, force: true }); }
}
const code = (value: string) => (error: unknown): boolean => (error as { code?: string }).code === value;

test('folder-browse: all names, lazy children, stable identities and supported links', async () => {
  await fixture(async (root, docs) => {
    const selected = path.join(root, 'selected');
    await mkdir(path.join(selected, 'notes'), { recursive: true });
    await writeFile(path.join(selected, 'README.MARKDOWN'), '# Read me\n');
    await writeFile(path.join(selected, 'plain.txt'), 'visible only');
    await writeFile(path.join(selected, 'notes', 'nested.md'), '# Nested\n');
    await symlink('README.MARKDOWN', path.join(selected, 'linked.md'));
    await symlink('notes', path.join(selected, 'linked-notes'));
    await symlink('..', path.join(selected, 'notes', 'parent'));
    const folders = new Folders(docs);
    const tree = await folders.select(selected);
    assert.deepEqual(tree.entries.map(entry => entry.name), ['linked-notes', 'notes', 'linked.md', 'plain.txt', 'README.MARKDOWN']);
    assert.deepEqual((await folders.list(tree.id)).entries, tree.entries);
    await writeFile(path.join(selected, 'added.md'), '# Added');
    const refreshed = await folders.list(tree.id);
    assert.equal(refreshed.entries.length, tree.entries.length + 1);
    for (const entry of tree.entries) {
      assert.equal(refreshed.entries.find(current => current.name === entry.name)!.id, entry.id);
    }
    const note = tree.entries.find(entry => entry.name === 'notes')!;
    const nested = await folders.list(note.id);
    assert.equal((await folders.open(nested.entries.find(entry => entry.name === 'nested.md')!.id)).text, '# Nested\n');
    await assert.rejects(folders.list(nested.entries.find(entry => entry.name === 'parent')!.id), code('folder-cycle'));
    const linked = tree.entries.find(entry => entry.name === 'linked.md')!;
    assert.equal(linked.linked, true);
    assert.equal((await folders.open(linked.id)).text, '# Read me\n');
    assert.equal((await folders.list(tree.entries.find(entry => entry.name === 'linked-notes')!.id)).entries.length, 2);
    await assert.rejects(folders.open(tree.entries.find(entry => entry.name === 'plain.txt')!.id), code('unsupported'));
    await assert.rejects(folders.open(note.id), code('unsupported'));
    await assert.rejects(folders.open(selected), code('folder-grant'));
    await assert.rejects(folders.list('invented'), code('folder-grant'));
  });
});

test('folder-errors: empty, vanished, unreadable and outside links', async () => {
  await fixture(async (root, docs) => {
    const selected = path.join(root, 'selected');
    await mkdir(selected);
    const folders = new Folders(docs);
    const empty = await folders.select(selected);
    assert.equal(empty.entries.length, 0);
    await writeFile(path.join(root, 'outside.md'), '# Outside');
    await symlink('../outside.md', path.join(selected, 'outside.md'));
    await symlink('missing.md', path.join(selected, 'broken.md'));
    const tree = await folders.list(empty.id);
    assert.equal(tree.entries.length, 2);
    for (const entry of tree.entries) {
      assert.equal(entry.linked, true);
      assert.ok(entry.notice);
      await assert.rejects(folders.open(entry.id));
    }
    await chmod(selected, 0);
    try { await assert.rejects(folders.list(empty.id), code('folder-permission')); }
    finally { await chmod(selected, 0o755); }
    await rm(selected, { recursive: true });
    await assert.rejects(folders.list(empty.id), code('folder-missing'));
    await assert.rejects(folders.select(path.join(root, 'outside.md')), code('folder-type'));
  });
});

test('rename-collision: existing and newly created targets keep both files; success updates grants', async () => {
  await fixture(async (root, docs) => {
    const source = path.join(root, 'old.md');
    const target = path.join(root, 'new.md');
    await writeFile(source, '# Original\n');
    const original = await docs.select(source);
    const second = await docs.select(source, path.dirname(root));
    const actions = new FileActions(docs, async () => {});
    await writeFile(target, '# Existing\n');
    await assert.rejects(actions.rename(original.id, 'new.md', original.revision), code('EEXIST'));
    assert.equal(await readFile(source, 'utf8'), '# Original\n');
    assert.equal(await readFile(target, 'utf8'), '# Existing\n');
    await unlink(target);
    const collision = new FileActions(docs, async () => {}, {
      link: async (from, to) => { await writeFile(to, '# Arrived\n'); await link(from, to); }
    });
    await assert.rejects(collision.rename(original.id, 'new.md', original.revision), code('EEXIST'));
    assert.equal(await readFile(source, 'utf8'), '# Original\n');
    assert.equal(await readFile(target, 'utf8'), '# Arrived\n');
    await unlink(target);
    const renamed = await actions.rename(original.id, 'new.md', original.revision);
    assert.equal(renamed.id, original.id);
    assert.equal(renamed.name, 'new.md');
    assert.equal((await docs.read(second.id)).name, 'new.md');
    assert.equal(await readFile(target, 'utf8'), '# Original\n');
    await assert.rejects(lstat(source), code('ENOENT'));
  });
});

test('rename-case: a letter-case change renames the file on a case-insensitive disk', async t => {
  await fixture(async (root, docs) => {
    const source = path.join(root, 'note.md');
    await writeFile(source, '# Note\n');
    const caseInsensitive = await lstat(path.join(root, 'NOTE.md')).then(() => true, () => false);
    if (!caseInsensitive) { t.skip('This disk treats letter case as different names.'); return; }
    const view = await docs.select(source);
    const actions = new FileActions(docs, async () => {});
    const renamed = await actions.rename(view.id, 'Note.md', view.revision);
    assert.equal(renamed.name, 'Note.md');
    assert.deepEqual(await readdir(root), ['Note.md']);
    assert.equal(await readFile(path.join(root, 'Note.md'), 'utf8'), '# Note\n');
    assert.equal((await docs.read(view.id)).name, 'Note.md');
    const other = path.join(root, 'other.md');
    await writeFile(other, '# Other\n');
    await assert.rejects(actions.rename(view.id, 'OTHER.md', renamed.revision), code('EEXIST'));
    assert.equal(await readFile(other, 'utf8'), '# Other\n');
    assert.equal(await readFile(path.join(root, 'Note.md'), 'utf8'), '# Note\n');
  });
});

test('rename-collision: failed source removal rolls back only the created target', async () => {
  await fixture(async (root, docs) => {
    const source = path.join(root, 'old.md');
    await writeFile(source, '# Original');
    const view = await docs.select(source);
    const actions = new FileActions(docs, async () => {}, {
      unlink: async file => {
        if (file === source) throw Object.assign(new Error('test input: refused source unlink'), { code: 'EACCES' });
        await unlink(file);
      }
    });
    await assert.rejects(actions.rename(view.id, 'new.md', view.revision), code('EACCES'));
    assert.equal(await readFile(source, 'utf8'), '# Original');
    await assert.rejects(lstat(path.join(root, 'new.md')), code('ENOENT'));
    assert.equal((await docs.read(view.id)).name, 'old.md');
    const target = path.join(root, 'replaced.md');
    const replacedTarget = new FileActions(docs, async () => {}, {
      unlink: async file => {
        if (file === source) {
          await unlink(target);
          await writeFile(target, '# Separate target');
          throw Object.assign(new Error('test input: refused source unlink'), { code: 'EACCES' });
        }
        await unlink(file);
      }
    });
    await assert.rejects(replacedTarget.rename(view.id, 'replaced.md', view.revision), code('EACCES'));
    assert.equal(await readFile(source, 'utf8'), '# Original');
    assert.equal(await readFile(target, 'utf8'), '# Separate target');
  });
});

test('trash-failure: callback failure keeps content and authority; success removes all matching grants', async () => {
  await fixture(async (root, docs) => {
    const source = path.join(root, 'trash.md');
    await writeFile(source, '# Keep');
    const view = await docs.select(source);
    const second = await docs.select(source, path.dirname(root));
    const failed = new FileActions(docs, async () => { throw Object.assign(new Error('test input: Trash unavailable'), { code: 'EPERM' }); });
    await assert.rejects(failed.trash(view.id, view.revision), code('EPERM'));
    assert.equal(await readFile(source, 'utf8'), '# Keep');
    assert.equal((await docs.read(view.id)).text, '# Keep');
    let destination = '';
    const succeeded = new FileActions(docs, async file => { destination = file; await unlink(file); });
    await succeeded.trash(view.id, view.revision);
    assert.equal(destination, source);
    assert.throws(() => docs.get(view.id), code('grant'));
    assert.throws(() => docs.get(second.id), code('grant'));
  });
});

test('file-action-guard: invalid names, stale content, links and permission failures keep original files', async () => {
  await fixture(async (root, docs) => {
    const source = path.join(root, 'guard.md');
    await writeFile(source, '# Original');
    const view = await docs.select(source);
    let trashCalls = 0;
    const actions = new FileActions(docs, async () => { trashCalls++; });
    for (const name of ['../escape.md', 'a/b.md', 'a\\b.md', '.', '..', '', 'name.txt', 'nul\0.md', 'line\n.md', 'bad:name.md', 9]) {
      await assert.rejects(actions.rename(view.id, name, view.revision), code('rename-name'));
    }
    await assert.rejects(actions.rename('invalid', 'good.md', view.revision), code('grant'));
    await assert.rejects(actions.trash(view.id, 'invalid'), code('revision'));
    await writeFile(source, '# Changed outside');
    await assert.rejects(actions.rename(view.id, 'good.md', view.revision), code('outside-change'));
    await assert.rejects(actions.trash(view.id, view.revision), code('outside-change'));
    const fresh = await docs.read(view.id);
    await chmod(source, 0o444);
    try { await assert.rejects(actions.trash(view.id, fresh.revision), code('read-only')); }
    finally { await chmod(source, 0o644); }
    const other = path.join(root, 'other.md');
    await link(source, other);
    await assert.rejects(actions.rename(view.id, 'good.md', fresh.revision), code('hard-link'));
    await unlink(source);
    await symlink('other.md', source);
    await assert.rejects(actions.trash(view.id, fresh.revision), code('file-type'));
    assert.equal(trashCalls, 0);
    assert.equal(await readFile(other, 'utf8'), '# Changed outside');
  });
});

test('file-action-guard: refuses a file this user cannot write, even when its group can', { skip: process.getuid?.() === 0 ? 'The root user ignores file permissions.' : false }, async () => {
  await fixture(async (root, docs) => {
    const source = path.join(root, 'guard.md');
    await writeFile(source, '# Original');
    const view = await docs.select(source);
    let trashCalls = 0;
    const actions = new FileActions(docs, async () => { trashCalls++; });
    await chmod(source, 0o460);
    await assert.rejects(actions.rename(view.id, 'renamed.md', view.revision), code('read-only'));
    await assert.rejects(actions.trash(view.id, view.revision), code('read-only'));
    assert.equal(trashCalls, 0);
    assert.deepEqual(await readdir(root), ['guard.md']);
  });
});
