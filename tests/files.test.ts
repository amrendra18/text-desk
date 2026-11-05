import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Documents, revision } from '../src/main/documents.js';
import { FileWrites } from '../src/main/files.js';
import { prepareSaveText } from '../src/shared/document.js';

async function fixture(text: string | Buffer = '# Original\n') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'text-desk-save-'));
  const file = path.join(root, 'note.md');
  await writeFile(file, text, { mode: 0o640 });
  const docs = new Documents();
  const view = await docs.select(file);
  return { root, file, docs, grant: docs.get(view.id), view, clean: () => rm(root, { recursive: true, force: true }) };
}

test('manual-save replaces complete bytes and preserves permissions', async () => {
  const f = await fixture();
  try {
    const before = await stat(f.file);
    const result = await new FileWrites().save(f.grant, f.view.revision, '# Edited\n');
    assert.equal(await readFile(f.file, 'utf8'), '# Edited\n');
    assert.deepEqual(result, { text: '# Edited\n', revision: revision(Buffer.from('# Edited\n')) });
    assert.equal((await stat(f.file)).mode & 0o777, before.mode & 0o777);
    assert.notEqual((await stat(f.file)).ino, before.ino);
    assert.deepEqual(await readdir(f.root), ['note.md']);
  } finally { await f.clean(); }
});

test('manual-save keeps extended attributes and the creation date', async () => {
  const f = await fixture();
  try {
    execFileSync('xattr', ['-w', 'com.example.kept', 'kept', f.file]);
    const past = new Date('2020-01-02T03:04:05Z');
    await utimes(f.file, past, past);
    const born = (await stat(f.file)).birthtimeMs;
    await new FileWrites().save(f.grant, f.view.revision, '# Edited\n');
    assert.equal(await readFile(f.file, 'utf8'), '# Edited\n');
    assert.equal(execFileSync('xattr', ['-p', 'com.example.kept', f.file], { encoding: 'utf8' }), 'kept\n');
    assert.equal((await stat(f.file)).birthtimeMs, born);
    assert.deepEqual(await readdir(f.root), ['note.md']);
  } finally { await f.clean(); }
});

test('manual-save keeps a creation date later than the modification date', { skip: existsSync('/usr/bin/SetFile') ? false : 'needs SetFile from the Xcode command line tools' }, async () => {
  const f = await fixture();
  try {
    const past = new Date('2020-01-02T03:04:05Z');
    await utimes(f.file, past, past);
    execFileSync('SetFile', ['-d', '06/15/2023 12:00:00', f.file]);
    const born = (await stat(f.file)).birthtimeMs;
    assert.ok(born > past.getTime());
    await new FileWrites().save(f.grant, f.view.revision, '# Edited\n');
    assert.equal((await stat(f.file)).birthtimeMs, born);
  } finally { await f.clean(); }
});

test('manual-save still works when the attributes cannot be copied', async () => {
  const f = await fixture();
  try {
    const before = await stat(f.file);
    const saver = new FileWrites({ copyWithAttributes: async () => { throw new Error('test input: no attribute support'); } });
    await saver.save(f.grant, f.view.revision, '# Edited\n');
    assert.equal(await readFile(f.file, 'utf8'), '# Edited\n');
    assert.equal((await stat(f.file)).mode & 0o777, before.mode & 0o777);
    assert.deepEqual(await readdir(f.root), ['note.md']);
  } finally { await f.clean(); }
});

test('hard-linked files open read-only', async () => {
  const f = await fixture();
  try {
    await link(f.file, path.join(f.root, 'second.md'));
    assert.equal((await f.docs.select(f.file)).writable, false);
  } finally { await f.clean(); }
});

test('encoding-preservation restores three newline styles and the UTF-8 marker', async () => {
  for (const ending of ['\n', '\r\n', '\r']) {
    for (const marker of ['', '\uFEFF']) {
      const original = `${marker}one${ending}two${ending}`;
      const f = await fixture(original);
      try {
        const writes = new FileWrites();
        const before = await stat(f.file);
        const unchanged = await writes.save(f.grant, f.view.revision, 'one\ntwo\n');
        assert.equal(unchanged.text, original);
        assert.equal((await stat(f.file)).ino, before.ino);
        assert.deepEqual(await readFile(f.file), Buffer.from(original));
        const edited = `${marker}one${ending}three${ending}`;
        assert.equal((await writes.save(f.grant, unchanged.revision, 'one\nthree\n')).text, edited);
        assert.deepEqual(await readFile(f.file), Buffer.from(edited));
      } finally { await f.clean(); }
    }
  }
});

test('encoding-preservation retains unchanged mixed endings and refuses mixed-ending edits', async () => {
  const f = await fixture('\uFEFFone\r\ntwo\nthree\r');
  try {
    const writes = new FileWrites();
    const result = await writes.save(f.grant, f.view.revision, 'one\ntwo\nthree\n');
    assert.equal(result.text, f.view.text);
    await assert.rejects(writes.save(f.grant, result.revision, 'edited\ntwo\nthree\n'), { code: 'mixed-endings' });
    assert.deepEqual(await readFile(f.file), Buffer.from(f.view.text));
    for (const invalid of ['a\0b', 'a\uD800b']) {
      await assert.rejects(writes.save(f.grant, result.revision, invalid), { code: 'encoding' });
    }
    assert.equal(prepareSaveText('plain', 'new\nline'), 'new\nline');
  } finally { await f.clean(); }
});

test('save-order serializes grants for the same file and releases the queue after failure', async () => {
  const f = await fixture('original');
  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  let writes = 0;
  const saver = new FileWrites({ write: async (handle, bytes) => {
    writes += 1;
    if (writes === 1) { started(); await paused; }
    await handle.writeFile(bytes);
  } });
  try {
    const first = saver.save(f.grant, f.view.revision, 'first');
    await writing;
    const second = saver.save({ ...f.grant, id: 'other-grant' }, revision(Buffer.from('first')), 'second');
    const otherFile = path.join(f.grant.root, 'other.md');
    await writeFile(otherFile, 'other');
    await saver.save({ ...f.grant, path: otherFile }, revision(Buffer.from('other')), 'independent');
    assert.equal(await readFile(f.file, 'utf8'), 'original');
    assert.equal(writes, 2);
    release();
    assert.equal((await first).text, 'first');
    assert.equal((await second).text, 'second');
    await assert.rejects(saver.save(f.grant, f.view.revision, 'stale'), { code: 'outside-change' });
    assert.equal((await saver.save(f.grant, revision(Buffer.from('second')), 'third')).text, 'third');
  } finally { release(); await f.clean(); }
});

test('save-failure keeps the original and removes only its own temporary file', async () => {
  for (const stage of ['write', 'replace']) {
    const f = await fixture('original');
    const sentinel = path.join(f.root, '.unrelated.tmp');
    await writeFile(sentinel, 'keep');
    const injected = Object.assign(new Error('forced disk failure'), { code: 'ENOSPC' });
    const saver = stage === 'write'
      ? new FileWrites({ write: async (handle) => { await handle.writeFile('partial'); throw injected; } })
      : new FileWrites({ replace: async () => { throw injected; } });
    try {
      await assert.rejects(saver.save(f.grant, f.view.revision, 'draft'), { code: 'ENOSPC' });
      assert.equal(await readFile(f.file, 'utf8'), 'original');
      assert.equal(await readFile(sentinel, 'utf8'), 'keep');
      assert.deepEqual((await readdir(f.root)).sort(), ['.unrelated.tmp', 'note.md']);
      assert.equal((await new FileWrites().save(f.grant, f.view.revision, 'retry')).text, 'retry');
    } finally { await f.clean(); }
  }
});

test('outside-change detects content changes before writing and before replacement', async () => {
  for (const stage of ['before', 'during']) {
    const f = await fixture('original');
    let writes = 0;
    const saver = new FileWrites({ write: async (handle, bytes) => {
      writes += 1;
      await handle.writeFile(bytes);
      await writeFile(f.file, 'external');
    } });
    try {
      if (stage === 'before') await writeFile(f.file, 'external');
      await assert.rejects(saver.save(f.grant, f.view.revision, 'draft'), { code: 'outside-change' });
      assert.equal(writes, stage === 'before' ? 0 : 1);
      assert.equal(await readFile(f.file, 'utf8'), 'external');
      assert.deepEqual(await readdir(f.root), ['note.md']);
    } finally { await f.clean(); }
  }
});

test('save refuses unsupported bytes, read-only files, links, and directories', async () => {
  for (const kind of ['encoding', 'readonly', 'hardlink', 'symlink', 'directory']) {
    const f = await fixture('original');
    try {
      if (kind === 'encoding') await writeFile(f.file, Buffer.from([0xff]));
      if (kind === 'readonly') await chmod(f.file, 0o444);
      if (kind === 'hardlink') await link(f.file, path.join(f.root, 'linked.md'));
      if (kind === 'symlink' || kind === 'directory') {
        await rm(f.file);
        if (kind === 'directory') await mkdir(f.file);
        else {
          await writeFile(path.join(f.root, 'target.md'), 'target');
          await symlink(path.join(f.root, 'target.md'), f.file);
        }
      }
      const code = { encoding: 'encoding', readonly: 'read-only', hardlink: 'hard-link', symlink: 'file-type', directory: 'file-type' }[kind];
      await assert.rejects(new FileWrites().save(f.grant, f.view.revision, 'draft'), { code });
      if (kind === 'symlink') assert.equal(await readFile(path.join(f.root, 'target.md'), 'utf8'), 'target');
      if (kind === 'hardlink') assert.equal(await readFile(path.join(f.root, 'linked.md'), 'utf8'), 'original');
      assert.equal((await readdir(f.root)).some(name => name.endsWith('.tmp')), false);
    } finally { await f.clean(); }
  }
});

test('save checks permissions again before replacement', async () => {
  const f = await fixture('original');
  const saver = new FileWrites({ write: async (handle, bytes) => {
    await handle.writeFile(bytes);
    await chmod(f.file, 0o444);
  } });
  try {
    await assert.rejects(saver.save(f.grant, f.view.revision, 'draft'), { code: 'read-only' });
    assert.equal(await readFile(f.file, 'utf8'), 'original');
    assert.deepEqual(await readdir(f.root), ['note.md']);
    const handle = await open(f.file, 'r');
    await handle.close();
  } finally { await f.clean(); }
});

test('save refuses a file this user cannot write, even when its group can', { skip: process.getuid?.() === 0 ? 'The root user ignores file permissions.' : false }, async () => {
  const f = await fixture('original');
  try {
    await chmod(f.file, 0o460);
    await assert.rejects(new FileWrites().save(f.grant, f.view.revision, 'draft'), { code: 'read-only' });
    assert.equal(await readFile(f.file, 'utf8'), 'original');
    assert.deepEqual(await readdir(f.root), ['note.md']);
    await chmod(f.file, 0o640);
    assert.equal((await new FileWrites().save(f.grant, f.view.revision, 'draft')).text, 'draft');
  } finally { await f.clean(); }
});

test('save-copy refuses every spelling of the original and keeps its bytes', async () => {
  const f = await fixture('original');
  const writes = new FileWrites();
  try {
    const linkedFolder = path.join(f.root, 'linked-folder');
    await symlink(f.root, linkedFolder);
    const spellings = [f.grant.path, f.file, path.join(linkedFolder, 'note.md'), path.join(linkedFolder, 'linked-folder', 'note.md')];
    const otherCase = path.join(f.root, 'NOTE.md');
    if (await lstat(otherCase).then(() => true, () => false)) spellings.push(otherCase);
    const hardLink = path.join(f.root, 'hard-link.md');
    await link(f.file, hardLink);
    spellings.push(hardLink);
    for (const destination of spellings) {
      await assert.rejects(writes.saveCopy(f.docs, f.grant, destination, 'draft'), { code: 'copy' }, destination);
      assert.equal(await readFile(f.file, 'utf8'), 'original');
    }
    await unlink(hardLink);
    const symbolicLink = path.join(f.root, 'symbolic-link.md');
    await symlink(f.file, symbolicLink);
    await assert.rejects(writes.saveCopy(f.docs, f.grant, symbolicLink, 'draft'), { code: 'copy-link' });
    assert.equal(await readFile(f.file, 'utf8'), 'original');
  } finally { await f.clean(); }
});

test('save-copy writes a new file or another existing file, also after the original is gone', async () => {
  const f = await fixture('original');
  const writes = new FileWrites();
  try {
    const created = path.join(f.root, 'created.md');
    assert.equal((await writes.saveCopy(f.docs, f.grant, created, 'new text')).text, 'new text');
    assert.equal(await readFile(created, 'utf8'), 'new text');
    const occupied = path.join(f.root, 'occupied.md');
    await writeFile(occupied, 'old text');
    assert.equal((await writes.saveCopy(f.docs, f.grant, occupied, 'second text')).text, 'second text');
    assert.equal(await readFile(occupied, 'utf8'), 'second text');
    assert.equal(await readFile(f.file, 'utf8'), 'original');
    await rm(f.file);
    assert.equal((await writes.saveCopy(f.docs, f.grant, occupied, 'third text')).text, 'third text');
    assert.equal(await readFile(occupied, 'utf8'), 'third text');
  } finally { await f.clean(); }
});
