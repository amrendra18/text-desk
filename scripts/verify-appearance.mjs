import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, get } from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const themes = ['ember', 'graphite', 'midnight', 'plum', 'paper', 'system'];
const labels = ['Ember', 'Graphite', 'Midnight', 'Plum', 'Paper', 'System'];
const themeColors = {
  ember: { paper: '#1c1b1a', surface: '#242220', ink: '#eee7df', accent: '#f3a65b', muted: '#b5aaa0' },
  graphite: { paper: '#181818', surface: '#202020', ink: '#ededed', accent: '#c4c9d2', muted: '#b0b0b0' },
  midnight: { paper: '#141821', surface: '#1b2130', ink: '#e2e8f5', accent: '#94b8ff', muted: '#a2afc7' },
  plum: { paper: '#201925', surface: '#292030', ink: '#efe3f4', accent: '#d9a8ec', muted: '#bcabc5' },
  paper: { paper: '#f6f4f0', surface: '#fffdfa', ink: '#302b26', accent: '#984515', muted: '#6d6258' }
};

export async function verifyAppearance({ electron, page, scratch, evidence, check, openFile, restart }) {
  const folder = path.join(scratch, 'appearance');
  await mkdir(folder, { recursive: true });
  const measurements = {
    layouts: [],
    stand_ins: [
      'The driver selects disposable files through the native picker boundary.',
      'Browser media emulation supplies light and dark appearance for the System choice.',
      'Keyboard events come from Playwright; native keyboard behavior is checked by hand separately.'
    ],
    unverified: ['Native picker interaction and actual Mac appearance changes require the manual checklist from scripts/hand-journey.']
  };
  const fixture = path.join(folder, 'appearance.md');
  await writeFile(fixture, '# Appearance check\n\nA readable paragraph with **bold text**, *emphasis*, and `code`.\n\n- One item\n- Another item\n');

  async function settingsOpen() {
    await page.locator('#settings').click();
    await page.locator('#settings-dialog').waitFor();
  }
  async function settingsReady() {
    await page.waitForFunction(() => [...document.querySelectorAll('#settings-dialog input')].every(input => !input.disabled));
  }
  async function storedSettings() {
    const result = await page.evaluate(() => window.desk.settings());
    assert.equal(result.ok, true);
    return result.value;
  }
  async function chooseTheme(theme, actual = theme) {
    await page.locator(`input[name=theme][value=${theme}]`).check();
    await settingsReady();
    assert.equal((await storedSettings()).theme, theme);
    await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, actual);
  }
  async function autosave(enabled) {
    await page.locator('#autosave').setChecked(enabled);
    await settingsReady();
    assert.equal((await storedSettings()).autosave, enabled);
  }
  async function saved() {
    await page.waitForFunction(() => document.querySelector('#status')?.textContent?.trim().endsWith('Saved'));
  }
  async function resize(width, height) {
    await electron.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
    await page.waitForFunction(size => innerWidth === size.width && innerHeight === size.height, { width, height });
  }
  async function layout() {
    return page.evaluate(() => {
      const rect = element => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
      };
      const visible = element => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
      };
      const dialog = document.querySelector('#settings-dialog');
      const style = getComputedStyle(document.documentElement);
      const colors = Object.fromEntries(['paper', 'surface', 'ink', 'accent', 'muted'].map(name => [name, style.getPropertyValue(`--${name}`).trim()]));
      return {
        viewport: { width: innerWidth, height: innerHeight },
        palette: document.documentElement.dataset.theme,
        colors,
        dialog: rect(dialog),
        dialog_visible: visible(dialog),
        dialog_scroll: { width: dialog.scrollWidth, client_width: dialog.clientWidth, height: dialog.scrollHeight, client_height: dialog.clientHeight },
        controls: [...document.querySelectorAll('#settings-dialog input, #settings-close, #filebar > button, #filebar .views button, #file-actions')].map(element => ({ name: element.id || element.value, visible: visible(element), rect: rect(element) })),
        editor: rect(document.querySelector('#editor')),
        preview: rect(document.querySelector('#preview')),
        editor_read_only: document.querySelector('#editor').readOnly,
        preview_text: document.querySelector('#preview').textContent
      };
    });
  }

  try {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openFile(fixture);
    await page.locator('#edit-view').click();
    await settingsOpen();
    await autosave(false);
    await page.locator('#settings-close').click();

    await check('theme-layout', async () => {
      const paletteColors = new Map();
      for (const [width, height] of [[1280, 800], [1000, 700]]) {
        await resize(width, height);
        await settingsOpen();
        assert.equal(await page.locator('input[name=theme]').count(), 6);
        for (const label of labels) assert.equal(await page.getByRole('radio', { name: new RegExp(`^${label}(?:\\s|$)`) }).count(), 1);
        for (const theme of themes) {
          await chooseTheme(theme, theme === 'system' ? 'ember' : theme);
          const observed = await layout();
          assert.deepEqual(observed.viewport, { width, height });
          assert.equal(observed.dialog_visible, true, `${theme} Settings extends beyond the window.`);
          assert(observed.dialog_scroll.width <= observed.dialog_scroll.client_width + 1, `${theme} Settings clips horizontally.`);
          assert(observed.dialog_scroll.height <= observed.dialog_scroll.client_height + 1, `${theme} Settings clips vertically.`);
          for (const control of observed.controls) assert.equal(control.visible, true, `${theme} clips ${control.name}.`);
          assert.equal(observed.editor_read_only, false);
          assert(observed.editor.width > 0 && observed.editor.height > 0);
          assert(observed.preview.width > 0 && observed.preview.height > 0);
          assert(observed.preview_text.includes('A readable paragraph'));
          assert.deepEqual(observed.colors, themeColors[observed.palette], 'Text and surface colors differ from the theme definition.');
          if (theme !== 'system') paletteColors.set(theme, JSON.stringify(observed.colors));
          measurements.layouts.push({ theme, ...observed });
          await page.screenshot({ path: path.join(evidence, `screens/theme-${theme}-${width}x${height}-settings.png`) });
          await page.locator('#settings-close').click();
          await page.locator('#editor').focus();
          await page.keyboard.insertText('Theme typing check. ');
          await page.waitForFunction(() => document.querySelector('#preview')?.textContent?.includes('Theme typing check.'));
          await page.locator('#save').click();
          await saved();
          assert.equal(await readFile(fixture, 'utf8'), await page.locator('#editor').inputValue());
          await page.screenshot({ path: path.join(evidence, `screens/theme-${theme}-${width}x${height}-editing.png`) });
          await settingsOpen();
        }
        await page.locator('#settings-close').click();
      }
      assert.equal(new Set(paletteColors.values()).size, 5, 'The five named palettes need distinct colors.');
    });

    await check('system-theme', async () => {
      await settingsOpen();
      await chooseTheme('system', 'ember');
      await page.emulateMedia({ colorScheme: 'light' });
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'paper');
      assert.equal((await storedSettings()).theme, 'system');
      await page.screenshot({ path: path.join(evidence, 'screens/system-light.png') });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'ember');
      assert.equal((await storedSettings()).theme, 'system');
      await page.screenshot({ path: path.join(evidence, 'screens/system-dark.png') });
      await page.locator('#settings-close').click();
      measurements.system = { light: 'paper', dark: 'ember', source: 'Browser media emulation' };
    });

    await check('settings-restart', async () => {
      await settingsOpen();
      await chooseTheme('plum');
      await autosave(true);
      await page.locator('#settings-close').click();
      ({ electron, page } = await restart());
      await page.locator('#welcome-open').waitFor();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'plum');
      assert.equal(await page.locator('#editor').count(), 0);
      const persisted = await storedSettings();
      assert.equal(persisted.theme, 'plum');
      assert.equal(persisted.autosave, true);
      await settingsOpen();
      assert.equal(await page.locator('input[name=theme][value=plum]').isChecked(), true);
      assert.equal(await page.locator('#autosave').isChecked(), true);
      await autosave(false);
      await page.locator('#settings-close').click();
      measurements.restart = { theme: persisted.theme, autosave: persisted.autosave, document_restored: false };
    });

    await check('keyboard-journeys', async () => {
      await openFile(fixture);
      await page.locator('#open-file').focus();
      let found = false;
      for (let count = 0; count < 30; count++) {
        await page.keyboard.press('Tab');
        if (await page.locator('#settings').evaluate(element => element === document.activeElement)) { found = true; break; }
      }
      assert.equal(found, true, 'Tab navigation did not reach Settings.');
      await page.keyboard.press('Enter');
      await page.locator('#settings-dialog').waitFor();
      const radio = page.locator('input[name=theme]:checked');
      const before = await radio.inputValue();
      await radio.focus();
      await page.keyboard.press('ArrowRight');
      await settingsReady();
      const after = await page.locator('input[name=theme]:checked').inputValue();
      assert.notEqual(after, before, 'Arrow navigation did not change the theme.');
      assert.equal((await storedSettings()).theme, after);
      await page.keyboard.press('Escape');
      await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
      await page.locator('#edit-view').click();
      const text = '# Keyboard save\n\nCommand-S wrote this disposable file.\n';
      await page.locator('#editor').fill(text);
      await page.locator('#editor').press('Meta+s');
      await saved();
      assert.equal(await readFile(fixture, 'utf8'), text);
      measurements.keyboard = { settings_tab_enter: true, radio_arrow: true, escape_close: true, command_s_disk_match: true };
    });

    await check('large-document', async () => {
      const file = path.join(folder, 'large-document.md');
      const bytes = 1229310;
      const header = '# Large document\n\n';
      const paragraph = 'Measured large document content. '.repeat(8) + '\n\n';
      const remaining = bytes - Buffer.byteLength(header);
      const text = header + paragraph.repeat(Math.ceil(remaining / paragraph.length)).slice(0, remaining);
      assert.equal(Buffer.byteLength(text), bytes);
      await writeFile(file, text);
      await page.evaluate(() => {
        globalThis.textDeskLoadingObservations = [];
        globalThis.textDeskLoadingObserver = new MutationObserver(records => {
          for (const record of records) {
            for (const node of record.addedNodes) globalThis.textDeskLoadingObservations.push(node.textContent ?? '');
          }
        });
        globalThis.textDeskLoadingObserver.observe(document.querySelector('#status'), { childList: true, subtree: true });
      });
      const opening = performance.now();
      try {
        await openFile(file);
        await page.getByRole('heading', { name: 'Large document', exact: true }).waitFor();
        measurements.large_document = { input_bytes: bytes, open_preview_ms: performance.now() - opening };
        const loading = await page.evaluate(() => globalThis.textDeskLoadingObservations);
        assert(loading.some(value => value.includes('Loading...')), 'The loading state was not observed.');
        measurements.large_document.loading_observed = true;
      } finally {
        await page.evaluate(() => {
          globalThis.textDeskLoadingObserver.disconnect();
          delete globalThis.textDeskLoadingObserver;
          delete globalThis.textDeskLoadingObservations;
        });
      }
      await page.locator('#edit-view').click();
      assert.equal(await page.locator('#editor').inputValue(), text);
      const addition = '\n\n## Large document final edit\n';
      const changed = text + addition;
      await page.locator('#editor').focus();
      await page.locator('#editor').press('Meta+ArrowDown');
      assert.equal(await page.locator('#editor').evaluate(element => element.selectionStart), text.length);
      const editing = performance.now();
      await page.keyboard.insertText(addition);
      await page.getByRole('heading', { name: 'Large document final edit', exact: true }).waitFor();
      measurements.large_document.preview_update_ms = performance.now() - editing;
      measurements.large_document.measurement_boundary = 'Driver edit request through visible preview heading; includes input delivery and rendering.';
      await page.locator('#save').click();
      await saved();
      assert.equal(await readFile(file, 'utf8'), changed);
      assert.equal(await page.locator('#editor').inputValue(), changed);
      await page.screenshot({ path: path.join(evidence, 'screens/large-document.png') });
    });

    await check('no-network', async () => {
      const observed = [];
      const server = createServer((request, response) => {
        observed.push(request.url);
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end('Observer control');
      });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      try {
        const address = server.address();
        assert(address && typeof address !== 'string');
        const base = `http://127.0.0.1:${address.port}`;
        await new Promise((resolve, reject) => {
          get(`${base}/observer-control`, response => { response.resume(); response.once('end', resolve); response.once('error', reject); }).once('error', reject);
        });
        assert.deepEqual(observed, ['/observer-control']);
        const file = path.join(folder, 'remote-resources.md');
        await writeFile(file, `# Remote resource check\n\n![Remote observation image](${base}/image.png)\n\n[Unclicked web link](${base}/link)\n`);
        await openFile(file);
        await page.getByRole('heading', { name: 'Remote resource check', exact: true }).waitFor();
        assert.equal(await page.getByRole('link', { name: 'Unclicked web link' }).count(), 1);
        assert.equal(await page.locator('#preview img').count(), 0);
        assert((await page.locator('#preview').innerText()).includes('Remote observation image'));
        await page.waitForTimeout(300);
        assert.deepEqual(observed, ['/observer-control'], 'The app made an automatic request to the observer.');
        measurements.network = { observer_control_requests: 1, automatic_app_requests: 0, observation_after_render_ms: 300, scope: 'Loopback image and unclicked link fixture' };
      } finally {
        server.closeAllConnections();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    });
    await resize(1280, 800);
  } finally {
    await writeFile(path.join(evidence, 'traces/appearance.json'), JSON.stringify(measurements, null, 2));
  }
}
