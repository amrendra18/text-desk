import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

const normalized = text => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

export async function verifyFiles({ electron, page, scratch, corpus: sources, evidence, check }) {
  const fixtures = path.join(scratch, 'file-journeys');
  await mkdir(fixtures);
  const editor = page.locator('#editor');
  const tree = page.locator('#tree');
  const measurements = { corpus_files: 0, direct_entries: 0, sidebar_clicks: 0, bridge_opens: 0 };
  const entry = name => tree.locator(`.tree-entry[title=${JSON.stringify(name)}]`);

  async function chooseFolder(folder) {
    await electron.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: !selected, filePaths: selected ? [selected] : [] });
    }, folder);
    await page.locator('#open-folder').click();
    if (folder) await page.waitForFunction(name => document.querySelector('#folder-name')?.textContent?.trim() === name, path.basename(folder));
  }

  async function selected(name) {
    await page.waitForFunction(filename => document.querySelector('#filebar .breadcrumb')?.textContent?.trim().endsWith(filename), name);
  }

  async function showSource() {
    if (!(await editor.isVisible())) await page.locator('#raw-view').click();
  }

  async function openEntry(name, expected) {
    await entry(name).click();
    await selected(name);
    await showSource();
    assert.equal(await editor.inputValue(), normalized(expected));
    measurements.sidebar_clicks++;
  }

  async function action(name) {
    await page.locator('#file-actions').click();
    await page.locator(name === 'rename' ? '#rename-file' : '#trash-file').click();
  }

  async function rename(name) {
    await page.locator('#rename-dialog').waitFor();
    await page.locator('#rename-input').fill(name);
    await page.locator('#rename-confirm').click();
  }

  async function refresh() {
    await page.locator('#refresh-folder').click();
    await page.waitForFunction(() => !document.querySelector('#refresh-folder')?.disabled);
  }

  await page.locator('#settings').click();
  await page.locator('#autosave').setChecked(false);
  await page.waitForFunction(() => !document.querySelector('#autosave')?.disabled);
  await page.locator('#settings-close').click();

  const browse = path.join(fixtures, 'browse');
  const nested = path.join(browse, 'nested');
  await mkdir(nested, { recursive: true });
  await mkdir(path.join(browse, 'empty'));
  await writeFile(path.join(browse, 'first.md'), '# Root document\n');
  await writeFile(path.join(nested, 'nested.MARKDOWN'), '# Nested document\n');
  await writeFile(path.join(browse, 'notes.txt'), 'Unsupported text stays visible.\n');

  await check('folder-browse', async () => {
    await chooseFolder(browse);
    assert.equal(await tree.locator('.tree-entry').count(), 4);
    assert.equal(await entry('nested').getAttribute('data-kind'), 'directory');
    assert.equal(await entry('notes.txt').getAttribute('data-kind'), 'unsupported');
    await openEntry('first.md', '# Root document\n');
    const unsupported = entry('notes.txt');
    if (!(await unsupported.isDisabled())) await unsupported.click();
    assert.equal(await editor.inputValue(), '# Root document\n');
    await entry('empty').click();
    assert.equal(await entry('empty').getAttribute('aria-expanded'), 'true');
    assert.equal(await entry('empty').locator('xpath=following-sibling::*[1]').locator('.tree-entry').count(), 0);
    await entry('nested').click();
    assert.equal(await entry('nested').getAttribute('aria-expanded'), 'true');
    await openEntry('nested.MARKDOWN', '# Nested document\n');
    assert((await page.locator('#filebar .breadcrumb').innerText()).includes('nested'));
    await chooseFolder(null);
    assert.equal((await page.locator('#folder-name').innerText()).trim(), 'browse');
    assert.equal(await editor.inputValue(), '# Nested document\n');
    await page.screenshot({ path: path.join(evidence, 'screens/folder-browse.png') });
  });

  await check('folder-errors', async () => {
    const vanished = path.join(browse, 'vanished');
    await mkdir(vanished);
    await refresh();
    await entry('vanished').click();
    assert.equal(await entry('vanished').getAttribute('aria-expanded'), 'true');
    await entry('vanished').click();
    await rm(vanished, { recursive: true });
    await entry('vanished').click();
    await page.waitForFunction(() => Boolean(document.querySelector('#banner')?.textContent?.trim()));
    assert.equal(await editor.inputValue(), '# Nested document\n');
    await refresh();
    assert.equal(await entry('vanished').count(), 0);
    await openEntry('first.md', '# Root document\n');
  });

  await check('rename-collision', async () => {
    const original = '# Root document\n';
    const occupied = '# Existing destination stays intact\n';
    await writeFile(path.join(browse, 'occupied.md'), occupied);
    await action('rename');
    await rename('occupied.md');
    await page.waitForFunction(() => Boolean(document.querySelector('#rename-error')?.textContent?.trim()));
    assert.equal(await readFile(path.join(browse, 'first.md'), 'utf8'), original);
    assert.equal(await readFile(path.join(browse, 'occupied.md'), 'utf8'), occupied);
    assert.equal(await editor.inputValue(), original);
    await page.locator('#rename-cancel').click();
  });

  await check('file-action-guard', async () => {
    await page.locator('#edit-view').click();
    const draft = '# Keep this action draft\n';
    await editor.fill(draft);
    for (const kind of ['rename', 'trash']) {
      await action(kind);
      await page.locator('#guard-dialog').waitFor();
      await page.locator('#guard-cancel').click();
      assert.equal(await editor.inputValue(), draft);
      assert.equal(await readFile(path.join(browse, 'first.md'), 'utf8'), '# Root document\n');
      assert.equal(await page.locator(`#${kind}-dialog`).isVisible(), false);
    }
  });

  await check('rename-active-draft', async () => {
    const draft = await editor.inputValue();
    await action('rename');
    await page.locator('#guard-save').click();
    await rename('renamed.md');
    await selected('renamed.md');
    assert.equal(await editor.inputValue(), draft);
    assert.equal(await readFile(path.join(browse, 'renamed.md'), 'utf8'), draft);
    await assert.rejects(readFile(path.join(browse, 'first.md')), { code: 'ENOENT' });
    assert.equal(await entry('first.md').count(), 0);
    assert.equal(await entry('renamed.md').count(), 1);
    await editor.fill('# Edit after rename\n');
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#status')?.textContent?.trim().endsWith('Saved'));
    assert.equal(await readFile(path.join(browse, 'renamed.md'), 'utf8'), '# Edit after rename\n');
  });

  await check('trash-failure', async () => {
    const file = path.join(browse, 'renamed.md');
    const original = await readFile(file, 'utf8');
    const draft = '# Draft retained after failed Trash\n';
    await editor.fill(draft);
    await electron.evaluate(({ shell }, target) => {
      const originalTrash = shell.trashItem;
      globalThis.textDeskTrashControl = { originalTrash, called: false };
      shell.trashItem = async file => {
        if (file === target) {
          globalThis.textDeskTrashControl.called = true;
          throw Object.assign(new Error('Disposable Trash failure control.'), { code: 'EACCES' });
        }
        return originalTrash(file);
      };
    }, file);
    try {
      await action('trash');
      await page.locator('#guard-discard').click();
      await page.locator('#trash-confirm').click();
      for (let attempt = 0; attempt < 200 && !(await electron.evaluate(() => globalThis.textDeskTrashControl.called)); attempt++) await page.waitForTimeout(25);
      assert.equal(await electron.evaluate(() => globalThis.textDeskTrashControl.called), true);
      await page.waitForFunction(() => Boolean(document.querySelector('#banner')?.textContent?.trim()));
      assert.equal(await editor.inputValue(), draft);
      assert.equal(await readFile(file, 'utf8'), original);
      await selected('renamed.md');
      await page.screenshot({ path: path.join(evidence, 'screens/trash-failure.png') });
    } finally {
      await electron.evaluate(({ shell }) => {
        shell.trashItem = globalThis.textDeskTrashControl.originalTrash;
        delete globalThis.textDeskTrashControl;
      });
    }
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#status')?.textContent?.trim().endsWith('Saved'));
    assert.equal(await readFile(file, 'utf8'), draft);
  });

  await check('trash-real', async () => {
    const name = `text-desk-disposable-${randomUUID()}.md`;
    const file = path.join(browse, name);
    const trash = path.join(homedir(), '.Trash', name);
    const bytes = Buffer.from('# Disposable real Trash proof\n');
    await writeFile(file, bytes);
    await refresh();
    await openEntry(name, bytes.toString('utf8'));
    await action('trash');
    await page.locator('#trash-cancel').click();
    assert.deepEqual(await readFile(file), bytes);
    let moved = false;
    try {
      await action('trash');
      await page.locator('#trash-confirm').click();
      await page.waitForFunction(filename => ![...document.querySelectorAll('#tree .tree-entry')].some(item => item.getAttribute('title') === filename), name);
      await assert.rejects(readFile(file), { code: 'ENOENT' });
      moved = true;
      assert.deepEqual(await readFile(trash), bytes, 'The uniquely named Trash item must contain the original bytes.');
      await writeFile(path.join(evidence, 'logs/trash-proof.json'), JSON.stringify({ filename: name, bytes: bytes.length, source_absent: true, trash_contents_match: true }, null, 2));
    } catch (error) {
      await writeFile(path.join(evidence, 'logs/trash-proof.json'), JSON.stringify({ filename: name, source_absent: moved, trash_contents_match: false, unverified: 'Actual Trash contents require access to the unique disposable item.', error: String(error), retained_item: moved ? trash : null }, null, 2));
      throw error;
    }
    await rm(trash);
  });

  await check('folder-selection-order', async () => {
    const newer = path.join(fixtures, 'newer-folder');
    await mkdir(newer); await writeFile(path.join(newer, 'newer.md'), '# Newer folder\n');
    await chooseFolder(browse);
    await electron.evaluate((_, target) => {
      const fs = process.getBuiltinModule('fs/promises');
      const state = { original: fs.readdir, entered: false, release: undefined };
      const held = new Promise(resolve => { state.release = resolve; });
      globalThis.folderListControl = state;
      fs.readdir = async (...args) => {
        if (args[0] === target) { state.entered = true; await held; }
        return state.original(...args);
      };
    }, browse);
    try {
      await page.locator('#refresh-folder').click();
      for (let attempt = 0; attempt < 200 && !(await electron.evaluate(() => globalThis.folderListControl.entered)); attempt++) await page.waitForTimeout(25);
      assert.equal(await electron.evaluate(() => globalThis.folderListControl.entered), true);
      await chooseFolder(newer);
      await electron.evaluate(() => globalThis.folderListControl.release());
      await page.waitForFunction(() => !document.querySelector('#refresh-folder').disabled);
      assert.equal(await page.locator('#folder-name').innerText(), 'newer-folder');
      assert.equal(await entry('newer.md').count(), 1);
      assert.equal(await entry('renamed.md').count(), 0);
    } finally {
      await electron.evaluate(() => {
        const state = globalThis.folderListControl; state.release();
        process.getBuiltinModule('fs/promises').readdir = state.original;
        delete globalThis.folderListControl;
      });
    }
  });

  await check('copy-folder-selection', async () => {
    await chooseFolder(browse);
    const file = path.join(browse, 'renamed.md');
    await openEntry('renamed.md', await readFile(file, 'utf8'));
    await page.locator('#edit-view').click();
    await editor.fill('# Copy is a separate document\n');
    await writeFile(file, '# Outside revision stays\n');
    await page.locator('#save').click();
    await page.locator('#save-copy').waitFor();
    const copy = path.join(fixtures, 'occupied.md');
    await electron.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, copy);
    await page.locator('#save-copy').click();
    await selected('occupied.md');
    assert.equal(await page.locator('#folder-name').innerText(), 'Open file');
    assert.equal(await tree.locator('.tree-entry').count(), 0);
    assert.equal(await tree.locator('[aria-current=page]').innerText(), 'occupied.md');
    assert.equal(await readFile(copy, 'utf8'), '# Copy is a separate document\n');
    assert.equal(await readFile(path.join(browse, 'occupied.md'), 'utf8'), '# Existing destination stays intact\n');
  });

  await check('corpus-scale', async () => {
    assert.equal(sources.length, 31);
    const corpus = path.join(fixtures, 'large-corpus');
    await mkdir(corpus);
    const copies = [];
    for (let group = 0; group < 10; group++) {
      const folderName = `group-${group}`;
      const folder = path.join(corpus, folderName);
      await mkdir(folder);
      for (const [index, source] of sources.entries()) {
        const name = `${group}-${index}-${path.basename(source.path)}`;
        const file = path.join(folder, name);
        await cp(source.path, file);
        copies.push({ folderName, name, file });
      }
    }
    assert.equal(copies.length, 310);
    await chooseFolder(corpus);
    assert.equal(await tree.locator('.tree-entry[data-kind=directory]').count(), 10);
    for (let group = 0; group < 10; group++) {
      await entry(`group-${group}`).click();
      for (const copy of copies.filter(item => item.folderName === `group-${group}`)) {
        await openEntry(copy.name, await readFile(copy.file, 'utf8'));
        measurements.corpus_files++;
      }
    }
    assert.equal(await tree.locator('.tree-entry[data-kind=markdown]').count(), 310);
    assert.equal(measurements.corpus_files, 310);
    const wide = path.join(fixtures, 'wide-folder');
    await mkdir(wide);
    const names = Array.from({ length: 730 }, (_, index) => `entry-${String(index).padStart(4, '0')}.md`);
    for (const name of names) await writeFile(path.join(wide, name), `# ${name}\n`);
    await chooseFolder(wide);
    const visibleNames = await tree.locator('.tree-entry').evaluateAll(items => items.map(item => item.getAttribute('title')));
    assert.equal(visibleNames.length, 730);
    assert.equal(new Set(visibleNames).size, 730);
    assert.deepEqual([...visibleNames].sort(), [...names].sort());
    await openEntry(names[729], `# ${names[729]}\n`);
    measurements.direct_entries = visibleNames.length;
    await page.screenshot({ path: path.join(evidence, 'screens/folder-scale.png') });
    await writeFile(path.join(evidence, 'traces/files-scale.json'), JSON.stringify({ ...measurements, method: 'All 310 corpus copies opened through sidebar clicks. All 730 direct filenames matched, with the last entry opened through a sidebar click. No direct bridge opens.' }, null, 2));
  });
}
