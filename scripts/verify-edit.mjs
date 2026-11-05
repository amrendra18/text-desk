import assert from 'node:assert/strict';
import { chmod, cp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';

const normalized = text => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

export async function verifyEdit({ electron, page, scratch, corpus, evidence, check, openFile }) {
  const editor = page.locator('#editor');
  const status = page.locator('#status');
  const fixtures = path.join(scratch, 'editing');
  await mkdir(fixtures);

  async function untilFile(file, expected) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if ((await readFile(file)).equals(Buffer.from(expected))) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.deepEqual(await readFile(file), Buffer.from(expected));
  }

  async function saved() {
    await page.waitForFunction(() => document.querySelector('#status')?.textContent?.trim().endsWith('Saved'));
  }

  async function edit(file, initial) {
    if (initial !== undefined) await writeFile(file, initial);
    await openFile(file);
    await page.locator('#edit-view').click();
    assert.equal(await editor.getAttribute('readonly'), null);
  }

  async function autosave(enabled) {
    await page.locator('#settings').click();
    await page.locator('#settings-dialog').waitFor();
    await page.locator('#autosave').setChecked(enabled);
    await page.waitForFunction(() => !document.querySelector('#autosave').disabled);
    await page.locator('#settings-close').click();
    const settings = await page.evaluate(() => window.desk.settings());
    assert.equal(settings.ok, true);
    assert.equal(settings.value.autosave, enabled);
  }

  async function selectDestination(file) {
    await electron.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
    }, file);
  }

  async function openRequest(file) {
    await electron.evaluate(({ dialog }, destination) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destination] });
    }, file);
    await page.locator('#open-file').click();
    await page.locator('#guard-dialog').waitFor();
  }

  async function bridgeSaveUnchanged() {
    return page.evaluate(async () => {
      const opened = await window.desk.openFile();
      if (!opened.ok || !opened.value) throw new Error('The selected fixture did not open.');
      const document = opened.value;
      return window.desk.save(document.id, document.revision, document.text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'));
    });
  }

  await autosave(false);
  await check('manual-save', async () => {
    const file = path.join(fixtures, 'manual.md');
    await edit(file, '# Before\n');
    await editor.fill('# After button save\n\nA changed paragraph.\n');
    await page.getByRole('heading', { name: 'After button save', exact: true }).waitFor();
    assert.equal((await readFile(file, 'utf8')), '# Before\n');
    assert((await status.innerText()).endsWith('Unsaved changes'));
    await page.locator('#save').click();
    await saved();
    assert.equal(await readFile(file, 'utf8'), '# After button save\n\nA changed paragraph.\n');
    await editor.fill('# After keyboard save\n');
    await editor.press('Meta+s');
    await saved();
    assert.equal(await readFile(file, 'utf8'), '# After keyboard save\n');
    await page.getByRole('heading', { name: 'After keyboard save', exact: true }).waitFor();
    await page.screenshot({ path: path.join(evidence, 'screens/edit-save.png') });
  });

  await check('save-order', async () => {
    const file = path.join(fixtures, 'save-order.md');
    await edit(file, '# Starting version\n');
    await electron.evaluate((_, destination) => {
      const fs = process.getBuiltinModule('fs/promises');
      const control = { original: fs.rename, entered: false, release: undefined };
      const held = new Promise(resolve => { control.release = resolve; });
      globalThis.textDeskSaveControl = control;
      fs.rename = async (source, target) => {
        if (target === destination) {
          control.entered = true;
          await held;
        }
        return control.original(source, target);
      };
    }, file);
    try {
      await editor.fill('# First save snapshot\n');
      await page.locator('#save').click();
      const deadline = Date.now() + 10000;
      while (!(await electron.evaluate(() => globalThis.textDeskSaveControl.entered)) && Date.now() < deadline) {
        await page.waitForTimeout(25);
      }
      assert.equal(await electron.evaluate(() => globalThis.textDeskSaveControl.entered), true, 'Save did not reach the held replacement.');
      assert.equal(await readFile(file, 'utf8'), '# Starting version\n');
      await editor.fill('# Newer draft while saving\n');
      await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      assert.equal(await page.locator('#guard-dialog').isVisible(), false);
      await electron.evaluate(() => globalThis.textDeskSaveControl.release());
      await untilFile(file, '# First save snapshot\n');
      await page.locator('#guard-dialog').waitFor();
      await page.locator('#guard-cancel').click();
      await page.waitForFunction(() => document.querySelector('#status')?.textContent?.trim().endsWith('Unsaved changes'));
      assert.equal(await editor.inputValue(), '# Newer draft while saving\n');
      await page.locator('#save').click();
      await saved();
      assert.equal(await readFile(file, 'utf8'), '# Newer draft while saving\n');
    } finally {
      await electron.evaluate(() => {
        const control = globalThis.textDeskSaveControl;
        control.release();
        process.getBuiltinModule('fs/promises').rename = control.original;
        delete globalThis.textDeskSaveControl;
      });
    }
  });

  await check('save-navigation-pending', async () => {
    const file = path.join(fixtures, 'pending-navigation.md');
    const next = path.join(fixtures, 'pending-next.md');
    await writeFile(next, '# Next document\n');
    await edit(file, '# Before pending save\n');
    await electron.evaluate((_, destination) => {
      const fs = process.getBuiltinModule('fs/promises');
      const control = { original: fs.rename, entered: false, release: undefined };
      const held = new Promise(resolve => { control.release = resolve; });
      globalThis.textDeskSaveControl = control;
      fs.rename = async (source, target) => {
        if (target === destination) { control.entered = true; await held; }
        return control.original(source, target);
      };
    }, file);
    try {
      await editor.fill('# Pending save finishes first\n');
      await page.locator('#save').click();
      for (let tries = 0; tries < 400 && !(await electron.evaluate(() => globalThis.textDeskSaveControl.entered)); tries++) await page.waitForTimeout(25);
      assert.equal(await electron.evaluate(() => globalThis.textDeskSaveControl.entered), true);
      await electron.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); }, next);
      await page.locator('#open-file').click();
      assert.equal(await readFile(file, 'utf8'), '# Before pending save\n');
      assert((await page.locator('#filebar').innerText()).includes('pending-navigation.md'));
      await electron.evaluate(() => globalThis.textDeskSaveControl.release());
      await page.locator('#filebar').getByText(path.basename(next), { exact: true }).waitFor();
      assert.equal(await readFile(file, 'utf8'), '# Pending save finishes first\n');
      assert.equal(await editor.inputValue(), '# Next document\n');
    } finally {
      await electron.evaluate(() => {
        const control = globalThis.textDeskSaveControl;
        control.release(); process.getBuiltinModule('fs/promises').rename = control.original;
        delete globalThis.textDeskSaveControl;
      });
    }
  });

  await check('encoding-preservation', async () => {
    const cases = [
      ['lf', '# Original\n\nFirst line.\n', '# Updated\n\nSecond line.\n'],
      ['crlf', '# Original\r\n\r\nFirst line.\r\n', '# Updated\r\n\r\nSecond line.\r\n'],
      ['bom-crlf', '\uFEFF# Original\r\n\r\nFirst line.\r\n', '\uFEFF# Updated\r\n\r\nSecond line.\r\n'],
    ];
    for (const [name, original, expected] of cases) {
      const file = path.join(fixtures, `${name}.md`);
      await edit(file, original);
      assert.equal(await editor.inputValue(), normalized(original));
      const unchanged = await bridgeSaveUnchanged();
      assert.equal(unchanged.ok, true);
      assert.deepEqual(await readFile(file), Buffer.from(original));
      await editor.fill('# Updated\n\nSecond line.\n');
      await page.locator('#save').click();
      await saved();
      assert.deepEqual(await readFile(file), Buffer.from(expected));
    }
  });

  await check('corpus-roundtrip', async () => {
    assert.equal(corpus.length, 31);
    const folder = path.join(fixtures, 'corpus');
    await mkdir(folder);
    for (const [index, item] of corpus.entries()) {
      const file = path.join(folder, `${index}-${path.basename(item.path)}`);
      await cp(item.path, file);
      const before = await readFile(file);
      await edit(file);
      assert.equal(await editor.inputValue(), normalized(before.toString('utf8')));
      const result = await bridgeSaveUnchanged();
      assert.equal(result.ok, true, `Unchanged save failed for corpus copy ${index}.`);
      assert.deepEqual(await readFile(file), before, `Corpus copy ${index} changed bytes.`);
    }
  });

  await check('save-navigation', async () => {
    const first = path.join(fixtures, 'navigation-first.md');
    const second = path.join(fixtures, 'navigation-second.md');
    await writeFile(second, '# Second file\n');
    await edit(first, '# First file\n');
    const draft = '# Keep this draft\n';
    await editor.fill(draft);
    await openRequest(second);
    await page.locator('#guard-cancel').click();
    assert.equal(await editor.inputValue(), draft);
    assert.equal(await readFile(first, 'utf8'), '# First file\n');
    assert.equal(await page.locator('#filebar').getByText(path.basename(first), { exact: true }).count(), 1);
    await openRequest(second);
    await page.locator('#guard-save').click();
    await page.locator('#filebar').getByText(path.basename(second), { exact: true }).waitFor();
    assert.equal(await readFile(first, 'utf8'), draft);
    assert.equal(await readFile(second, 'utf8'), '# Second file\n');
    await page.locator('#edit-view').click();
    await editor.fill('# Discard this draft\n');
    await openRequest(first);
    await page.locator('#guard-discard').click();
    await page.locator('#filebar').getByText(path.basename(first), { exact: true }).waitFor();
    assert.equal(await readFile(second, 'utf8'), '# Second file\n');
  });

  await check('save-failure', async () => {
    const readOnlyForEveryone = 0o444;
    const ownerReadOnlyGroupWritable = 0o460;
    for (const mode of [readOnlyForEveryone, ownerReadOnlyGroupWritable]) {
      const name = `write-failure-${mode.toString(8)}`;
      const file = path.join(fixtures, `${name}.md`);
      const initial = '# Write failure control\n';
      const draft = '# This draft must stay\n';
      await edit(file, initial);
      await editor.fill(draft);
      await chmod(file, mode);
      try {
        await page.locator('#save').click();
        await page.locator('#retry-save').waitFor();
        assert.equal(await editor.inputValue(), draft);
        assert.equal(await readFile(file, 'utf8'), initial);
        await page.screenshot({ path: path.join(evidence, `screens/save-failure-${mode.toString(8)}.png`) });
      } finally {
        await chmod(file, 0o644);
      }
      await page.locator('#retry-save').click();
      await saved();
      assert.equal(await readFile(file, 'utf8'), draft);
    }
  });

  await check('outside-change', async () => {
    const file = path.join(fixtures, 'outside-change.md');
    const copy = path.join(fixtures, 'recovered-copy.md');
    const external = '# Changed by another program\n';
    const draft = '# Keep my local draft\n';
    await edit(file, '# Starting file\n');
    await editor.fill(draft);
    await writeFile(file, external);
    await page.locator('#save').click();
    await page.locator('#save-copy').waitFor();
    assert.equal(await editor.inputValue(), draft);
    assert.equal(await readFile(file, 'utf8'), external);
    const alias = path.join(fixtures, 'copy-alias.md');
    await symlink(file, alias);
    await selectDestination(alias);
    await page.locator('#save-copy').click();
    await page.waitForFunction(() => document.querySelector('#banner')?.textContent?.includes('Choose a regular file'));
    assert.equal(await editor.inputValue(), draft);
    assert.equal(await readFile(file, 'utf8'), external);
    const linkedFolder = path.join(scratch, 'linked-editing-folder');
    await symlink(fixtures, linkedFolder);
    await selectDestination(path.join(linkedFolder, path.basename(file)));
    await page.locator('#save-copy').click();
    await page.waitForFunction(() => document.querySelector('#banner')?.textContent?.includes('Choose another file'));
    assert.equal(await editor.inputValue(), draft);
    assert.equal(await readFile(file, 'utf8'), external);
    await selectDestination(copy);
    await page.locator('#save-copy').click();
    await untilFile(copy, draft);
    assert.equal(await readFile(file, 'utf8'), external);
    await edit(file);
    await editor.fill('# Draft before reload\n');
    const latest = '# Latest outside version\n';
    await writeFile(file, latest);
    await page.locator('#save').click();
    await page.locator('#reload-file').waitFor();
    await page.locator('#reload-file').click();
    await page.locator('#confirm-dialog').waitFor();
    await page.locator('#confirm-no').click();
    assert.equal(await editor.inputValue(), '# Draft before reload\n');
    await page.locator('#reload-file').click();
    await page.locator('#confirm-yes').click();
    await page.waitForFunction(text => document.querySelector('#editor')?.value === text, latest);
    assert.equal(await readFile(file, 'utf8'), latest);
  });

  await check('autosave', async () => {
    const file = path.join(fixtures, 'autosave.md');
    await edit(file, '# Autosave starts here\n');
    await autosave(true);
    const draft = '# Autosave wrote this\n';
    await editor.fill(draft);
    await untilFile(file, draft);
    await saved();
    assert.equal(await editor.inputValue(), draft);
    await autosave(false);
  });

  await check('autosave-error', async () => {
    const file = path.join(fixtures, 'autosave-error.md');
    const initial = '# Autosave failure control\n';
    await edit(file, initial);
    await autosave(true);
    await chmod(file, 0o444);
    try {
      await editor.fill('# First retained draft\n');
      await page.locator('#retry-save').waitFor();
      assert.equal(await editor.inputValue(), '# First retained draft\n');
      assert.equal(await readFile(file, 'utf8'), initial);
      await chmod(file, 0o644);
      await editor.fill('# Newer retained draft\n');
      await page.waitForTimeout(900);
      assert.equal(await editor.inputValue(), '# Newer retained draft\n');
      assert.equal(await readFile(file, 'utf8'), initial, 'Autosave resumed before Retry.');
      await page.locator('#retry-save').click();
      await untilFile(file, '# Newer retained draft\n');
      await saved();
    } finally {
      await chmod(file, 0o644);
      await autosave(false);
    }
  });

  await check('quit-guard', async () => {
    const file = path.join(fixtures, 'quit-guard.md');
    await edit(file, '# Before closing\n');
    const draft = '# Draft retained after Cancel\n';
    await editor.fill(draft);
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await page.locator('#guard-dialog').waitFor();
    await page.locator('#guard-cancel').click();
    assert.equal(page.isClosed(), false);
    assert.equal(await editor.inputValue(), draft);
    assert.equal(await readFile(file, 'utf8'), '# Before closing\n');
    await page.locator('#save').click();
    await saved();
    assert.equal(await readFile(file, 'utf8'), draft);
  });
}
