import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const binary = path.join(root, 'bin/text-desk');
const scratch = await mkdtemp(path.join(tmpdir(), 'text-desk-contract-'));
const state = path.join(scratch, 'state');
await mkdir(state);
const call = args => spawnSync(binary, args, { cwd: scratch, encoding: 'utf8', env: { ...process.env, TEXT_DESK_STATE_DIR: state } });
function run(program, args, cwd, env = process.env) {
  const result = spawnSync(program, args, { cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 2_000_000 });
  assert.equal(result.status, 0, `${program} ${args.join(' ')} failed: ${(result.stderr || result.stdout || result.error || '').toString().slice(-2000)}`);
  return result.stdout;
}
async function freshInstall() {
  const checkout = path.join(scratch, 'checkout');
  run('git', ['clone', '--no-hardlinks', root, checkout], scratch);
  const changed = [
    ...run('git', ['diff', '--name-only', '-z', 'HEAD'], root).split('\0'),
    ...run('git', ['ls-files', '--others', '--exclude-standard', '-z'], root).split('\0')
  ].filter(Boolean);
  for (const file of new Set(changed)) {
    const source = path.join(root, file);
    const destination = path.join(checkout, file);
    try { await access(source); await mkdir(path.dirname(destination), { recursive: true }); await cp(source, destination); }
    catch (error) { if (error.code === 'ENOENT') await rm(destination, { force: true }); else throw error; }
  }
  run('npm', ['ci', '--ignore-scripts'], checkout);
  run('npm', ['run', 'setup'], checkout);
  const unbuilt = spawnSync(process.execPath, ['scripts/verify.mjs', 'full', '--feature', 'cli-open', '--packaged'], { cwd: checkout, encoding: 'utf8' });
  assert.equal(unbuilt.status, 3);
  run('npm', ['run', 'package'], checkout);
  const installBin = path.join(scratch, 'installed');
  await mkdir(installBin);
  const link = path.join(installBin, 'text-desk');
  await symlink(path.join(checkout, 'bin/text-desk'), link);
  const metadata = JSON.parse(await readFile(path.join(checkout, 'package.json'), 'utf8'));
  const freshState = path.join(scratch, 'fresh-state');
  await mkdir(freshState);
  assert.equal(run(link, ['--version'], scratch, { ...process.env, TEXT_DESK_STATE_DIR: freshState }).trim(), `text-desk ${metadata.version}`);
  assert.deepEqual(await readdir(freshState), []);
  await rm(path.join(checkout, '.git'), { recursive: true, force: true });
  run('npm', ['run', 'package'], checkout);
  assert.equal(JSON.parse(await readFile(path.join(checkout, '.local/package/build.json'), 'utf8')).sourceCommit, '');
  console.log(`Fresh checkout install: text-desk ${metadata.version}; npm ci, setup, package, disposable link, and package without a .git folder worked.`);
}
try {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--fresh-install')) throw new Error('Usage: node scripts/contract-probes.mjs [--fresh-install]');
  const version = call(['--version']);
  assert.equal(version.status, 0); assert(version.stdout.includes(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version)); assert.equal(version.stdout.trim().split('\n').length, 1);
  const top = call(['--help']); const open = call(['open', '--help']); const help = call(['help', '--help']);
  for (const result of [top, open, help]) assert.equal(result.status, 0);
  assert.match(open.stdout, /Effects: reads, window, process, writes own state/);
  assert.match(help.stdout, /Effects: reads/);
  assert.match(open.stdout, /Exit codes:/);
  const wrongVerb = call(['no-such-verb', '--format', 'json']);
  const wrongFlag = call(['help', '--no-such-flag', '--format', 'json']);
  for (const result of [wrongVerb, wrongFlag]) {
    assert.equal(result.status, 2); assert.equal(result.stdout.trim().split('\n').length, 1);
    const value = JSON.parse(result.stdout);
    assert.match(value.error.code, /^[a-z]+(?:-[a-z]+)*$/);
    assert.equal(typeof value.error.message, 'string');
    assert(Array.isArray(value.error.next));
  }
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  for (const heading of ['Requirements', 'Install and run', 'What install writes', 'Network use', 'Remove']) assert(readme.includes(`## ${heading}`));
  assert(readme.includes('TEXT_DESK_STATE_DIR'));
  assert.deepEqual(await readdir(state), []);
  const unpackaged = spawnSync(process.execPath, [path.join(root, 'scripts/verify.mjs'), 'fast', '--feature', 'cli-open'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(unpackaged.status, 2);
  const invalid = spawnSync(process.execPath, [path.join(root, 'scripts/verify.mjs'), 'bogus-level', '--feature', 'cli-open', '--packaged', '--bogus-flag'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(invalid.status, 2);
  const usage = spawnSync(process.execPath, [path.join(root, 'scripts/verify.mjs'), '--help', '--feature', 'cli-open', '--packaged'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(usage.status, 0);
  assert.match(usage.stdout, /^Usage: scripts\/verify/);
  console.log('Command probes held: version, help, error objects, README sections, and no state written.');
  if (process.argv.includes('--fresh-install')) await freshInstall();
} finally { await rm(scratch, { recursive: true, force: true }); }
