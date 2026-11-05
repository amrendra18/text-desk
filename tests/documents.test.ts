import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Documents, decode, within } from '../src/main/documents.js';

test('boundary-authority and local-assets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'text-desk-unit-'));
  try {
    const folder = path.join(root, 'notes'); await mkdir(folder);
    const file = path.join(folder, 'a.md'); await writeFile(file, '# Hello');
    await writeFile(path.join(folder, 'pixel.png'), 'image');
    await writeFile(path.join(root, 'outside.md'), 'outside');
    await symlink(path.join(root, 'outside.md'), path.join(folder, 'escape.md'));
    const docs = new Documents(); const opened = await docs.select(file);
    assert.equal(opened.text, '# Hello'); assert.equal(opened.writable, true);
    assert.equal((await docs.asset(opened.id, 'pixel.png')).bytes.toString(), 'image');
    await assert.rejects(docs.read('../outside.md'));
    await assert.rejects(docs.localPath(opened.id, '../outside.md'));
    await assert.rejects(docs.localPath(opened.id, 'escape.md'));
    await assert.rejects(docs.localPath(opened.id, 'file:///etc/passwd'));
    await assert.rejects(docs.asset(opened.id, 'a.md'));
    assert.equal(within(folder, folder + '-other/file'), false);
    assert.equal(within(folder, path.join(folder, 'nested/a.md')), true);
    await assert.rejects(docs.select(path.join(folder, 'pixel.png')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('encoding-preservation reading', () => {
  assert.equal(decode(Buffer.from('\uFEFFa\r\nb\r\n')), '\uFEFFa\r\nb\r\n');
  assert.throws(() => decode(Buffer.from([0xff, 0xfe])));
  assert.throws(() => decode(Buffer.from('a\0b')));
});
