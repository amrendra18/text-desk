import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { archiveHash } from './electron-pins.mjs';
import { sourceState } from './source-state.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, '.local/package');
const artifact = path.join(output, 'text-desk.app');
const markerPath = 'Contents/Resources/text-desk-build.json';
function command(binary, args) {
  const result = spawnSync(binary, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${binary} exited ${result.status ?? 'without a status'}.`);
}
async function exists(target) {
  try { return await lstat(target); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/package.mjs\nBuild the source first with npm run build. Creates .local/package/text-desk.app.\nUses the verified local Electron archive. No download, launch, or installation.');
  process.exit(0);
}
if (process.argv.length !== 2) throw new Error('Unknown option. Use --help.');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Packaging requires an Apple silicon Mac.');
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const runtime = path.join(root, '.local/electron');
const verified = JSON.parse(await readFile(path.join(runtime, 'verified.json'), 'utf8'));
if (verified.version !== metadata.config.electronVersion) throw new Error('Run npm run setup for the configured Electron version.');
if (createHash('sha256').update(await readFile(path.join(runtime, 'electron.zip'))).digest('hex') !== archiveHash) throw new Error('Electron archive checksum does not match.');
await readFile(path.join(root, 'dist/src/main/index.js'));
await mkdir(output, { recursive: true });
const previous = await exists(artifact);
if (previous) {
  if (!previous.isDirectory() || previous.isSymbolicLink()) throw new Error('Existing package is not a script-owned directory.');
  const owner = JSON.parse(await readFile(path.join(artifact, markerPath), 'utf8'));
  if (owner.owner !== 'text-desk-package' || owner.schema !== 1) throw new Error('Existing package is not owned by this script.');
}
const { commit: sourceCommit, dirtyFiles } = sourceState(root);
const compiledFiles = {};
for (const file of (await readdir(path.join(root, 'dist/src'), { recursive: true, withFileTypes: true })).filter(entry => entry.isFile())) {
  const absolute = path.join(file.parentPath, file.name);
  compiledFiles[path.relative(path.join(root, 'dist/src'), absolute)] = createHash('sha256').update(await readFile(absolute)).digest('hex');
}
const build = {
  schema: 1, owner: 'text-desk-package', sourceCommit,
  dirtyFiles, version: metadata.version, electronVersion: verified.version, architecture: 'arm64',
  compiledFiles, builtAt: new Date().toISOString(), signature: 'ad-hoc local signature; no developer identity or notarization',
};
const staging = await mkdtemp(path.join(output, '.stage-'));
const stagedApp = path.join(staging, 'text-desk.app');
const backup = path.join(staging, 'previous.app');
let movedPrevious = false;
let published = false;
try {
  command('/usr/bin/ditto', ['-x', '-k', path.join(runtime, 'electron.zip'), staging]);
  await rename(path.join(staging, 'Electron.app'), stagedApp);
  const contents = path.join(stagedApp, 'Contents');
  const resources = path.join(contents, 'Resources');
  const app = path.join(resources, 'app');
  await mkdir(path.join(app, 'dist'), { recursive: true });
  await cp(path.join(root, 'dist/src'), path.join(app, 'dist/src'), { recursive: true });
  await writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'text-desk', version: metadata.version, private: true, main: 'dist/src/main/index.js' }) + '\n');
  await rm(path.join(resources, 'default_app.asar'), { force: true });
  const plist = path.join(contents, 'Info.plist');
  for (const [key, value] of Object.entries({ CFBundleDisplayName: 'text-desk', CFBundleName: 'text-desk', CFBundleIdentifier: 'local.textdesk.app', CFBundleExecutable: 'text-desk', CFBundleShortVersionString: metadata.version, CFBundleVersion: metadata.version })) {
    command('/usr/bin/plutil', ['-replace', key, '-string', value, plist]);
  }
  command('/usr/bin/plutil', ['-remove', 'ElectronAsarIntegrity', plist]);
  await rename(path.join(contents, 'MacOS/Electron'), path.join(contents, 'MacOS/text-desk'));
  await writeFile(path.join(stagedApp, markerPath), JSON.stringify(build, null, 2) + '\n');
  command('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements', stagedApp]);
  command('/usr/bin/codesign', ['--verify', '--deep', '--strict', stagedApp]);
  if (previous) { await rename(artifact, backup); movedPrevious = true; }
  await rename(stagedApp, artifact);
  published = true;
  const record = path.join(staging, 'build.json');
  await writeFile(record, JSON.stringify(build, null, 2) + '\n');
  await rename(record, path.join(output, 'build.json'));
  console.log(`Packaged ${artifact}\nSource commit ${sourceCommit || 'unknown (no Git history)'}; ${dirtyFiles.length} changed files recorded.\nFull ad-hoc bundle signature verified. Launch checks remain separate.`);
} catch (error) {
  if (movedPrevious && !published) {
    await rename(backup, artifact);
    movedPrevious = false;
  }
  throw error;
} finally {
  if (!movedPrevious || published) await rm(staging, { recursive: true, force: true });
  else console.error(`Previous package preserved at ${backup}. Restore it before packaging again.`);
}
