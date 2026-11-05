import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Preferences } from '../src/main/settings.js';

test('settings persist in order and damaged settings report defaults', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'text-desk-settings-'));
  try {
    const preferences = new Preferences(root);
    assert.deepEqual(await preferences.read(), { autosave: false, theme: 'ember' });
    await Promise.all([preferences.write({ autosave: true, theme: 'plum' }), preferences.write({ autosave: false, theme: 'paper' })]);
    assert.deepEqual(await new Preferences(root).read(), { autosave: false, theme: 'paper' });
    const stored = await readFile(path.join(root, 'settings.json'), 'utf8');
    assert.equal(JSON.parse(stored).version, 1);
    assert.throws(() => preferences.write({ autosave: 'yes', theme: 'missing' }), { code: 'settings' });
    assert.equal(await readFile(path.join(root, 'settings.json'), 'utf8'), stored);
    await writeFile(path.join(root, 'settings.json'), 'invalid');
    const recovered = await preferences.read();
    assert.equal(recovered.autosave, false); assert.equal(recovered.theme, 'ember'); assert(recovered.notice);
  } finally { await rm(root, { recursive: true, force: true }); }
});
