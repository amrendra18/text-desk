import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';
import { _electron } from 'playwright';

function signal(pid, name) {
  try { process.kill(pid, name); return true; } catch { return false; }
}
async function stopped(pid) {
  signal(pid, 'SIGTERM');
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!signal(pid, 0)) return true;
    await setTimeout(100);
  }
  return !signal(pid, 0);
}
const root = path.resolve(import.meta.dirname, '..');
const stamp = new Date().toISOString().replace(/[-:.]/g, '');
const evidence = path.join(root, '.local/verify', `${stamp}-${process.pid}`);
const scratch = await mkdtemp(path.join(root, '.local/verify-cli-fixture-'));
const binary = path.join(root, 'bin/text-desk');
const executable = path.join(root, '.local/package/text-desk.app/Contents/MacOS/text-desk');
const failureControl = process.argv.includes('--failure-control');
const fixture = path.join(scratch, 'sample.md');
let electron; let detachedPid;
const controls = [];
async function check(name, action) {
  await action(); controls.push(name);
}
try {
  await mkdir(path.join(evidence, 'screens'), { recursive: true });
  await writeFile(fixture, '# CLI sample\n');
  const build = JSON.parse(await readFile(path.join(root, '.local/package/build.json'), 'utf8'));
  for (const [file, digest] of Object.entries(build.compiledFiles)) {
    const bytes = await readFile(path.join(root, 'dist/src', file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
  }
  await check('cli-open-failure', async () => {
    const fake = path.join(scratch, 'failed-app');
    const fakeBin = path.join(fake, 'bin/text-desk');
    const fakeJs = path.join(fake, 'dist/src/cli/launcher.js');
    const fakeApp = path.join(fake, '.local/package/text-desk.app/Contents/MacOS/text-desk');
    for (const file of [fakeBin, fakeJs, fakeApp]) await mkdir(path.dirname(file), { recursive: true });
    await copyFile(binary, fakeBin);
    await copyFile(path.join(root, 'dist/src/cli/launcher.js'), fakeJs);
    await copyFile(path.join(root, 'package.json'), path.join(fake, 'package.json'));
    await writeFile(fakeApp, '#!/bin/sh\nexit 7\n');
    await chmod(fakeBin, 0o755); await chmod(fakeApp, 0o755);
    const failed = spawnSync(fakeBin, ['open', fixture, '--format', 'json'], { cwd: scratch, encoding: 'utf8', env: { ...process.env, TEXT_DESK_STATE_DIR: path.join(scratch, 'failed-profile') } });
    assert.equal(failed.status, 1);
    assert.equal(JSON.parse(failed.stdout).error.code, 'launch-failed');
    assert(!failed.stdout.includes('"opened"'));
  });
  await check('cli-open-launch', async () => {
    electron = await _electron.launch({ executablePath: failureControl ? path.join(scratch, 'missing-app') : executable, args: [`--profile=${path.join(scratch, 'playwright-profile')}`, `--open=${fixture}`], timeout: 30000 });
    const page = await electron.firstWindow();
    await page.locator('#filebar').getByText('sample.md', { exact: true }).waitFor();
    await page.locator('#preview h1').getByText('CLI sample', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(evidence, 'screens/cli-open.png') });
    await electron.evaluate(({ app }) => app.quit());
    await electron.close(); electron = undefined;
  });
  await check('cli-open-detach', async () => {
    const started = performance.now();
    const child = spawn(binary, ['open', fixture, '--format', 'json'], { cwd: scratch, env: { ...process.env, TEXT_DESK_STATE_DIR: path.join(scratch, 'detached-profile') }, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = [];
    const errors = [];
    child.stdout.on('data', data => output.push(String(data)));
    child.stderr.on('data', data => errors.push(String(data)));
    const exitCode = await new Promise(resolve => child.on('exit', resolve));
    assert.equal(exitCode, 0, errors.join('') || output.join(''));
    const reply = JSON.parse(output.join(''));
    assert.equal(reply.window, 'started'); assert.equal(reply.kind, 'file'); assert.equal(reply.opened, fixture);
    detachedPid = reply.pid;
    process.kill(detachedPid, 0);
    await writeFile(path.join(evidence, 'launch.json'), JSON.stringify({ ...reply, elapsed_ms: performance.now() - started, process_alive_after_launcher_exit: true }, null, 2));
  });
  await check('cli-open-refusal-cleanup', async () => {
    const invalid = path.join(scratch, 'invalid.md');
    const profile = path.join(scratch, 'refused-profile');
    await writeFile(invalid, Buffer.from([0xff, 0xfe]));
    const child = spawn(binary, ['open', invalid, '--format', 'json'], { cwd: scratch, env: { ...process.env, TEXT_DESK_STATE_DIR: profile }, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = [];
    child.stdout.on('data', data => output.push(String(data)));
    const exitCode = await new Promise(resolve => child.on('exit', resolve));
    assert.equal(exitCode, 1);
    assert.equal(JSON.parse(output.join('')).error.code, 'encoding');
    const shutdownDeadline = performance.now() + 10000;
    let running = true;
    let matches = [];
    while (running && performance.now() < shutdownDeadline) {
      const processes = spawnSync('ps', ['-axo', 'pid=,ppid=,stat=,command='], { encoding: 'utf8' });
      assert.equal(processes.status, 0);
      matches = processes.stdout.split('\n').filter(line => line.includes(`--profile=${profile}`));
      running = matches.length > 0;
      if (running) await setTimeout(100);
    }
    assert(!running, `A refused open left its app process running: ${matches.slice(0, 3).join(' | ')}`);
  });
  const other = path.join(scratch, 'other.md');
  const latest = path.join(scratch, 'latest.md');
  const folder = path.join(scratch, 'folder');
  await writeFile(other, '# Other file\n'); await writeFile(latest, '# Latest file\n');
  await mkdir(folder); await writeFile(path.join(folder, 'inside.md'), '# Inside\n');
  const handoffProfile = path.join(scratch, 'handoff-profile');
  const cli = args => new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: scratch, env: { ...process.env, TEXT_DESK_STATE_DIR: handoffProfile }, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = []; const stderr = [];
    child.stdout.on('data', data => stdout.push(String(data)));
    child.stderr.on('data', data => stderr.push(String(data)));
    child.on('error', reject);
    child.on('exit', code => resolve({ code, stdout: stdout.join(''), stderr: stderr.join('') }));
  });
  await check('cli-open-handoff', async () => {
    electron = await _electron.launch({ executablePath: executable, args: [`--profile=${handoffProfile}`, `--open=${fixture}`], timeout: 30000 });
    const page = await electron.firstWindow();
    await page.locator('#preview h1').getByText('CLI sample', { exact: true }).waitFor();
    await page.locator('#edit-view').click();
    await page.locator('#editor').fill('# Unsaved draft\n');
    const before = await readFile(fixture);
    const result = await cli(['open', other, '--format', 'json']);
    assert.equal(result.code, 0); assert.equal(JSON.parse(result.stdout).window, 'running');
    await page.locator('#guard-dialog[open]').waitFor();
    await page.locator('#guard-cancel').click();
    assert.equal(await page.locator('#editor').inputValue(), '# Unsaved draft\n');
    assert.deepEqual(await readFile(fixture), before);
    const again = await cli(['open', other, '--format', 'json']);
    assert.equal(again.code, 0); assert.equal(JSON.parse(again.stdout).window, 'running');
    await page.locator('#guard-dialog[open]').waitFor();
    await page.locator('#guard-discard').click();
    await page.locator('#preview h1').getByText('Other file', { exact: true }).waitFor();
    assert.deepEqual(await readFile(fixture), before);
  });
  await check('cli-open-queued-request', async () => {
    const page = await electron.firstWindow();
    await page.locator('#edit-view').click();
    await page.locator('#editor').fill('# Queued draft\n');
    await page.evaluate(() => {
      const dialog = document.querySelector('#guard-dialog');
      const original = dialog.showModal.bind(dialog);
      window.guardOpens = 0;
      dialog.showModal = () => { window.guardOpens++; original(); };
    });
    const first = await cli(['open', fixture, '--format', 'json']);
    assert.equal(first.code, 0);
    await page.locator('#guard-dialog[open]').waitFor();
    const queued = await cli(['open', latest, '--format', 'json']);
    assert.equal(queued.code, 0);
    await page.locator('#guard-cancel').click();
    await page.waitForFunction(() => window.guardOpens === 2);
    assert.equal(await page.locator('#editor').inputValue(), '# Queued draft\n');
    await page.locator('#guard-discard').click();
    await page.locator('#preview h1').getByText('Latest file', { exact: true }).waitFor();
    assert.equal((await readFile(other, 'utf8')), '# Other file\n');
  });
  await check('cli-open-folder', async () => {
    const result = await cli(['open', folder, '--format', 'json']);
    assert.equal(result.code, 0); assert.equal(JSON.parse(result.stdout).window, 'running');
    assert.equal(JSON.parse(result.stdout).kind, 'folder');
    const page = await electron.firstWindow();
    await page.locator('#tree').getByText('inside.md', { exact: true }).waitFor();
    const repeated = await cli(['open', folder, '--format', 'json']);
    assert.equal(repeated.code, 0); assert.equal(JSON.parse(repeated.stdout).window, 'running');
    assert.equal((await readFile(path.join(folder, 'inside.md'), 'utf8')), '# Inside\n');
  });
  await check('cli-open-refusals', async () => {
    const unsupported = path.join(scratch, 'plain.txt'); await writeFile(unsupported, 'plain');
    for (const [args, code, error] of [
      [['open', path.join(scratch, 'missing.md'), '--format', 'json'], 1, 'path-missing'],
      [['open', unsupported, '--format', 'json'], 1, 'not-markdown'],
      [['open', '--format', 'json'], 2, 'bad-call'],
      [['open', folder, '--no-such-flag', '--format', 'json'], 2, 'bad-call']
    ]) {
      const result = await cli(args);
      assert.equal(result.code, code);
      assert.equal(result.stdout.trim().split('\n').length, 1);
      assert.equal(JSON.parse(result.stdout).error.code, error);
    }
    const stateFile = path.join(scratch, 'state-is-a-file'); await writeFile(stateFile, 'blocked');
    const badState = spawnSync(binary, ['open', fixture, '--format', 'json'], { cwd: scratch, encoding: 'utf8', env: { ...process.env, TEXT_DESK_STATE_DIR: stateFile } });
    assert.equal(badState.status, 1);
    assert.equal(JSON.parse(badState.stdout).error.code, 'bad-state');
  });
  await electron.evaluate(({ app }) => app.quit());
  await electron.close(); electron = undefined;
  const summary = { feature: 'cli-open', result: 'proved', controls, fixture: 'disposable', packaged: true };
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`cli-open: ${controls.join(', ')} proved\n${evidence}`);
} catch (error) {
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify({ feature: 'cli-open', result: 'failed', controls, deliberate_test_input: failureControl, error: String(error) }, null, 2));
  console.error(`cli-open failed: ${String(error)}\n${evidence}`);
  process.exitCode = 1;
} finally {
  if (electron) await electron.close().catch(() => {});
  if (detachedPid && !(await stopped(detachedPid))) {
    signal(detachedPid, 'SIGKILL');
    process.exitCode = 1;
    console.error('cli-open failed: the detached app ignored SIGTERM, so cleanup stopped it with SIGKILL.');
  }
  await rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
