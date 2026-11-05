import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
await rm(path.join(root, 'dist'), { recursive: true, force: true });
for (const config of ['tsconfig.json', 'tsconfig.renderer.json']) {
  const run = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', config], { cwd: root, stdio: 'inherit' });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
const output = path.join(root, 'dist/src/renderer');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'package.json'), '{"type":"module"}\n');
for (const file of ['index.html', 'style.css', 'themes.css']) await cp(path.join(root, 'src/renderer', file), path.join(output, file));
await cp(path.join(root, 'node_modules/marked/lib/marked.umd.js'), path.join(output, 'markdown.js'));
console.log('Built Electron app, preload bridge, and page.');
