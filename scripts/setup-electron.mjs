import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { archiveHash, typesHash } from './electron-pins.mjs';
const root = path.resolve(import.meta.dirname, '..');
const target = path.join(root, '.local/electron');
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).config.electronVersion;
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This build currently requires an Apple silicon Mac.');
function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${binary} exited ${result.status ?? 'without a status'}`);
  return result;
}
try {
  await access(path.join(target, 'Electron.app/Contents/MacOS/Electron'));
  await access(path.join(target, 'electron.d.ts'));
  if (JSON.parse(await readFile(path.join(target, 'verified.json'), 'utf8')).version === version) { console.log(`Electron ${version} is ready.`); process.exit(0); }
} catch {}
await mkdir(target, { recursive: true });
async function download(name, url, hash) {
  const destination = path.join(target, name);
  try { if (createHash('sha256').update(await readFile(destination)).digest('hex') === hash) return destination; } catch {}
  command('/usr/bin/curl', ['--fail', '--location', '--proto', '=https', '--tlsv1.2', '--silent', '--show-error', '--output', destination, url]);
  const actual = createHash('sha256').update(await readFile(destination)).digest('hex');
  if (actual !== hash) throw new Error(`Checksum mismatch for ${name}. Nothing was extracted.`);
  console.log(`${name}: checksum verified.`);
  return destination;
}
const archive = await download('electron.zip', `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-darwin-arm64.zip`, archiveHash);
const declarations = await download('electron.tgz', `https://registry.npmjs.org/electron/-/electron-${version}.tgz`, typesHash);
command('/usr/bin/ditto', ['-x', '-k', archive, target]);
const types = command('/usr/bin/tar', ['-xOf', declarations, 'package/electron.d.ts'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 4 * 1024 * 1024 });
await writeFile(path.join(target, 'electron.d.ts'), types.stdout);
command('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--ignore-resources', path.join(target, 'Electron.app')]);
await writeFile(path.join(target, 'verified.json'), JSON.stringify({ version, signature: 'ad-hoc code verified; vendor resource seal absent', archives: 'pinned SHA-256 verified' }) + '\n');
console.log(`Electron ${version} archive checksums and ad-hoc code verified. Vendor resource seal is absent.`);
