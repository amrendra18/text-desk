import { verifyAppearance } from './verify-appearance.mjs';
import { verifyFiles } from './verify-files.mjs';
import { verifyEdit } from './verify-edit.mjs';
import { verifyReading } from './verify-reading.mjs';
import { readCorpusManifest, writeSampleCorpus } from './corpus.mjs';
import { sourceState } from './source-state.mjs';
import { _electron } from 'playwright';
import { access, mkdir, mkdtemp, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const level = args[0] ?? 'fast';
const selected = args.includes('--feature') ? args[args.indexOf('--feature') + 1] : level === 'fast' ? 'smoke' : undefined;
const packaged = args.includes('--packaged') || (level === 'full' && !selected);
if (args.includes('--help')) { console.log('Usage: scripts/verify [fast|full] [--feature smoke|open-read|edit-save|files|appearance|cli-open] [--packaged]\nIt checks the setup, drives the real app, and keeps evidence.\nExit 0 proved, 1 feature failed, 2 usage, 3 environment unavailable.\nMap: verify/features/README.md\nA native picker stand-in selects disposable fixture files; the real Electron app handles them.\n--failure-control deliberately requests a missing element or missing executable.'); process.exit(0); }
if (!['fast', 'full'].includes(level) || (selected && !['smoke', 'open-read', 'edit-save', 'files', 'appearance', 'cli-open'].includes(selected)) || args.some((arg, i) => ![0, args.indexOf('--feature'), args.indexOf('--feature') + 1].includes(i) && !['--failure-control', '--packaged'].includes(arg))) { console.error('Invalid verification arguments. Use --help.'); process.exit(2); }
if (selected === 'cli-open' && !packaged) { console.error('The cli-open check runs only on the packaged app. Add --packaged.'); process.exit(2); }
const stamp = new Date().toISOString().replace(/[-:.]/g, '');
const evidence = path.join(root, '.local/verify', `${stamp}-${process.pid}`);
const executable = path.join(root, packaged ? '.local/package/text-desk.app/Contents/MacOS/text-desk' : '.local/electron/Electron.app/Contents/MacOS/Electron');
try { await access(executable); await access(path.join(root, 'dist/src/main/index.js')); }
catch { console.error('Doctor: run npm ci, npm run setup, and npm run build first. Full packaged checks also need npm run package. Nothing launched.'); process.exit(3); }
if (selected === 'cli-open') { await import('./verify-cli.mjs'); process.exit(process.exitCode ?? 0); }
for (const folder of ['screens', 'traces', 'logs']) await mkdir(path.join(evidence, folder), { recursive: true });
let corpusManifest = null;
try {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (selected !== 'smoke') corpusManifest = await readCorpusManifest(root);
  await writeFile(path.join(evidence, 'logs/doctor.json'), JSON.stringify({ runtime: executable, local_socket: 'available', corpus: selected === 'smoke' ? 'not needed' : corpusManifest ? 'manifest' : 'sample' }, null, 2));
} catch (error) {
  console.error(`Doctor unavailable. Nothing launched. ${error.code ?? error.message}\n${evidence}`); process.exit(3);
}
const scratch = await mkdtemp(path.join(root, '.local/verify-fixture-'));
const corpus = selected === 'smoke' ? [] : corpusManifest ?? await writeSampleCorpus(path.join(scratch, 'sample-corpus'));
const profile = path.join(scratch, 'profile');
const fixture = path.join(scratch, 'sample.md');
const example = '# A real Markdown file\n\n**Bold** and *italic*.\n\n| Name | State |\n| --- | --- |\n| Note | Ready |\n\n- [x] Checked\n- [ ] Waiting\n\n```js\nconst answer = 42;\n```\n\n![Local pixel](pixel.png)\n\n[Related note](related.md)\n\n<script>globalThis.compromised = true</script>\n\n![Remote test image](https://example.invalid/tracker.png)\n\n[Unsafe](javascript:alert(1))\n';
await writeFile(fixture, example);
await writeFile(path.join(scratch, 'related.md'), '# Related note');
await writeFile(path.join(scratch, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64'));
let electron; let page; let pid; let trace = false; let launchCount = 0; let cleanlyClosed = false;
const rows = []; const errors = []; const requests = [];
const controls = []; const previewMeasurements = [];
const start = performance.now();
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE'));
const check = async (name, action) => { const began = performance.now(); await action(); controls.push({ name, result: 'proved', duration_ms: performance.now() - began }); };
async function openFile(file) {
  await electron.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: !selectedPath, filePaths: selectedPath ? [selectedPath] : [] }); }, file);
  const openedAt = performance.now();
  await page.locator('#open-file').click();
  if (file) await page.locator('#filebar').getByText(path.basename(file), { exact: true }).waitFor();
  if (file) previewMeasurements.push({ bytes: (await readFile(file)).length, open_preview_ms: performance.now() - openedAt });
}
async function launchApp() {
  cleanlyClosed = false;
  electron = await _electron.launch({ executablePath: executable, args: [...(packaged ? [] : [root]), `--profile=${profile}`], env, timeout: 30000 });
  pid = electron.process().pid;
  page = await electron.firstWindow({ timeout: 30000 });
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.context().tracing.start({ screenshots: true, snapshots: true }); trace = true; launchCount++;
  await page.locator('#welcome-open').waitFor();
  return { electron, page };
}
async function closeClean() {
  if (trace) { await page.context().tracing.stop({ path: path.join(evidence, `traces/app-${launchCount}.zip`) }); trace = false; }
  const process = electron.process();
  const began = performance.now();
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Normal quit did not stop the app within 30 seconds.')), 30000);
    process.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  await electron.evaluate(({ app }) => app.quit()).catch(() => {});
  await exited;
  assert.throws(() => globalThis.process.kill(pid, 0), { code: 'ESRCH' });
  cleanlyClosed = true;
  await writeFile(path.join(evidence, `logs/quit-${launchCount}.json`), JSON.stringify({ duration_ms: performance.now() - began, pid, process_stopped: true }));
}
async function restart() { await closeClean(); return launchApp(); }
try {
  await launchApp();
  const launch = performance.now() - start;
  if (packaged) await check('packaged-launch', async () => {
    const actual = await electron.evaluate(({ app }) => ({ packaged: app.isPackaged, appPath: app.getAppPath() }));
    assert.equal(actual.packaged, true); assert(actual.appPath.includes('text-desk.app/Contents/Resources/app'));
    const build = JSON.parse(await readFile(path.join(root, '.local/package/build.json'), 'utf8'));
    if (build.compiledFiles) {
      for (const [file, digest] of Object.entries(build.compiledFiles)) {
        assert.equal(createHash('sha256').update(await readFile(path.join(root, 'dist/src', file))).digest('hex'), digest, `Rebuild the package after changing ${file}.`);
        assert.equal(createHash('sha256').update(await readFile(path.join(actual.appPath, 'dist/src', file))).digest('hex'), digest);
      }
    } else throw new Error('Rebuild the package to record compiled file checksums.');
    await writeFile(path.join(evidence, 'logs/package.json'), JSON.stringify(actual, null, 2));
  });
  await check('open-read', async () => {
    await openFile(fixture);
    await page.locator('#preview h1').waitFor();
    assert.equal(await page.locator('#preview h1').innerText(), 'A real Markdown file');
    assert.equal(await page.locator('#preview tbody tr').count(), 1);
    assert.equal(await page.locator('#preview input[type=checkbox]').count(), 2);
    assert.equal(await page.locator('#preview input[type=checkbox]:checked').count(), 1);
    assert.equal(await page.locator('#preview pre code').innerText(), 'const answer = 42;\n');
    await page.waitForFunction(() => { const img = document.querySelector('#preview img'); return img instanceof HTMLImageElement && img.complete && img.naturalWidth === 1; });
    await page.locator('#raw-view').click();
    assert.equal(await page.locator('#editor').inputValue(), example);
    assert.equal(await page.locator('#editor').getAttribute('readonly'), '');
    await page.screenshot({ path: path.join(evidence, 'screens/source.png') });
    await page.getByRole('link', { name: 'Related note', exact: true }).click();
    await page.getByRole('heading', { name: 'Related note', exact: true }).waitFor();
    await openFile(null);
    assert.equal(await page.locator('#preview h1').innerText(), 'Related note');
  });
  await check('markdown-inert', async () => {
    await openFile(fixture);
    assert.equal(await page.evaluate(() => globalThis.compromised), undefined);
    assert.equal(await page.locator('#preview script').count(), 0);
    assert((await page.locator('#preview').innerText()).includes('<script>globalThis.compromised'));
    assert.equal(await page.evaluate(() => typeof globalThis.require), 'undefined');
    assert.deepEqual(requests, []);
    await page.screenshot({ path: path.join(evidence, 'screens/reading.png') });
  });
  await check('heading-isolation', async () => {
    const collision = path.join(scratch, 'collisions.md');
    const text = '# Status\n\n# Editor\n\n[Broken anchor](#%ZZ)';
    await writeFile(collision, text); await openFile(collision);
    assert.equal(await page.locator('#preview h1').first().innerText(), 'Status');
    assert.equal(await page.locator('#preview h1').nth(1).innerText(), 'Editor');
    if (!(await page.locator('textarea#editor').count())) await page.locator('#raw-view').click();
    assert.equal(await page.locator('textarea#editor').inputValue(), text);
    await page.getByRole('link', { name: 'Broken anchor' }).click();
    assert.equal(await page.locator('#banner').innerText(), 'This link has an invalid destination.');
  });
  await check('notice-retry', async () => {
    await electron.evaluate(({ dialog }, missing) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [missing] }); }, path.join(scratch, 'missing.md'));
    await page.locator('#open-file').click();
    await page.locator('#banner button', { hasText: 'Retry' }).waitFor();
    await page.getByRole('link', { name: 'Broken anchor' }).click();
    assert.equal(await page.locator('#banner').innerText(), 'This link has an invalid destination.');
    assert.equal(await page.locator('#banner button').count(), 0, 'A later notice kept the Retry button of an earlier failed open.');
  });
  await check('heading-anchors', async () => {
    const repeated = path.join(scratch, 'repeated-headings.md');
    await writeFile(repeated, '# Same\n\n## Same\n\n## Same\n\n## Other\n');
    await openFile(repeated);
    assert.deepEqual(await page.locator('#preview :is(h1, h2)').evaluateAll(headings => headings.map(heading => heading.id)), ['md-same', 'md-same-1', 'md-same-2', 'md-other']);
  });
  await check('reload-guard', async () => {
    await openFile(fixture);
    await page.locator('#edit-view').click();
    const original = await page.locator('#editor').inputValue();
    const draft = `${original}\nAn unsaved line.\n`;
    await page.locator('#editor').fill(draft);
    const offered = await electron.evaluate(({ Menu, BrowserWindow }) => {
      const roles = new Set(['reload', 'forcereload', 'toggledevtools']);
      const items = [];
      const walk = menu => { for (const item of menu.items) { if (roles.has(String(item.role).toLowerCase())) items.push(item); if (item.submenu) walk(item.submenu); } };
      walk(Menu.getApplicationMenu());
      const reload = items.find(item => String(item.role).toLowerCase() === 'reload');
      const target = BrowserWindow.getAllWindows()[0];
      if (reload) reload.click(undefined, target, target.webContents);
      return items.map(item => String(item.role));
    });
    await new Promise(resolve => setTimeout(resolve, 750));
    assert.equal(await page.locator('#editor').inputValue(), draft, 'The View menu reload discarded the draft.');
    assert.deepEqual(offered, []);
    await page.locator('#editor').fill(original);
  });
  await check('read-only-after-edit', async () => {
    const locked = path.join(scratch, 'locked.md');
    await writeFile(locked, '# Locked note\n', { mode: 0o444 });
    await openFile(fixture);
    await page.locator('#edit-view').click();
    assert.equal(await page.locator('#editor').getAttribute('readonly'), null);
    await openFile(locked);
    assert.equal(await page.locator('#edit-view').isDisabled(), true);
    assert.equal(await page.locator('#editor').getAttribute('readonly'), '');
  });
  await verifyReading({ electron, page, scratch, evidence, check, openFile });
  if (selected !== 'smoke') await check('corpus-read', async () => {
    assert.equal(corpus.length, 31);
    const copies = path.join(scratch, 'corpus'); await mkdir(copies);
    for (const [index, item] of corpus.entries()) {
      const destination = path.join(copies, `${index}-${path.basename(item.path)}`);
      await cp(item.path, destination);
      const text = await readFile(destination, 'utf8');
      await openFile(destination);
      if (!(await page.locator('#editor').count())) await page.locator('#raw-view').click();
      assert.equal(await page.locator('#editor').inputValue(), text);
    }
    controls.push({ name: 'corpus-size', files: corpus.length, source: corpusManifest ? 'manifest' : 'sample', result: 'proved' });
  });
  await check('boundary-authority', async () => {
    const result = await page.evaluate(() => window.desk.read('../../outside.md'));
    assert.equal(result.ok, false); assert.equal(result.code, 'grant');
    assert.equal(await page.evaluate(() => typeof window.desk.invoke), 'undefined');
    const credentials = await page.evaluate(() => window.desk.link('', 'https://user:secret@example.invalid/'));
    assert.equal(credentials.ok, false); assert.equal(credentials.code, 'link');
  });
  const readingMemory = await electron.evaluate(({ app }) => app.getAppMetrics().map(item => ({ type: item.type, memory: item.memory })));
  if (!selected || selected === 'edit-save') await verifyEdit({ electron, page, scratch, corpus, evidence, check, openFile });
  if (!selected || selected === 'files') await verifyFiles({ electron, page, scratch, corpus, evidence, check });
  if (!selected || selected === 'appearance') await verifyAppearance({ electron, page, scratch, root, evidence, check, openFile, restart });
  if (args.includes('--failure-control')) await page.locator('#deliberately-missing-element').waitFor({ timeout: 250 });
  const memory = await electron.evaluate(async ({ app }) => app.getAppMetrics().map(item => ({ type: item.type, memory: item.memory })));
  await writeFile(path.join(evidence, 'traces/runtime.json'), JSON.stringify({ launch_ms: launch, previewMeasurements, memory_unit: 'KiB', reading_memory: readingMemory, memory }, null, 2));
  await check('runtime-measure', async () => { assert(previewMeasurements.length >= (selected === 'smoke' ? 3 : 31)); assert(memory.length > 0); });
  assert.deepEqual(errors, []);
  await check('shutdown', closeClean);
  rows.push({ feature: selected ?? 'open-read, edit-save, files, appearance', result: 'proved', controls });
} catch (error) {
  rows.push({ feature: selected ?? 'open-read, edit-save, files, appearance', result: 'failed', reason: error.stack ?? String(error), controls });
  if (page) await page.screenshot({ path: path.join(evidence, 'screens/failure.png') }).catch(() => {});
} finally {
  if (trace) await page.context().tracing.stop({ path: path.join(evidence, `traces/app-${launchCount}.zip`) }).catch(error => rows.push({ feature: 'evidence', result: 'failed', reason: error.message }));
  const bystander = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  try {
    if (electron && !cleanlyClosed) { await electron.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {}); await electron.close(); }
    if (pid) { assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }); }
    process.kill(bystander.pid, 0);
    controls.push({ name: 'harness-cleanup', result: 'proved', app_stopped: true, unrelated_control_alive: true });
  } catch (error) { rows.push({ feature: 'cleanup', result: 'failed', reason: String(error) }); }
  finally { bystander.kill(); await rm(scratch, { recursive: true, force: true }); }
}
await writeFile(path.join(evidence, 'logs/page-errors.json'), JSON.stringify(errors));
await writeFile(path.join(evidence, 'logs/requests.json'), JSON.stringify(requests));
const summary = { level, packaged, source_commit: sourceState(root).commit, features: rows, stand_ins: ['System appearance uses browser media emulation. Keyboard events come from Playwright.', 'Trash failure control substitutes the native operation for one disposable file. Real Trash also runs separately.', 'Native open and Save copy pickers return disposable fixture selections through Electron dialog boundary. Slow-save control pauses one disposable file replacement through the test driver.', ...(selected !== 'smoke' && !corpusManifest ? ['No corpus manifest exists, so the corpus checks used a generated sample of 31 notes.'] : [])], unverified: ['Native picker interaction and actual Mac appearance changes require the manual checklist from scripts/hand-journey.'], evidence };
await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
await writeFile(path.join(evidence, 'summary.md'), rows.map(row => `${row.feature}: ${row.result}${row.reason ? '\n' + row.reason : ''}`).join('\n'));
await writeFile(path.join(evidence, 'index.html'), '<!doctype html><meta charset="utf-8"><title>text-desk verification</title><h1>Verification evidence</h1><p>Read summary.json for checks, stand-ins, and limits.</p><a href="summary.json">Results</a><p><img src="screens/reading.png" width="800" alt="Reading"><img src="screens/source.png" width="800" alt="Source"></p>');
for (const row of rows) console.log(`${row.feature}: ${row.result}${row.reason ? ' - ' + row.reason.split('\n')[0] : ''}`);
console.log(evidence);
process.exit(rows.some(row => row.result !== 'proved') ? 1 : 0);
