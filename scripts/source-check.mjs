import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
async function scan(folder) {
  for (const item of await readdir(folder, { withFileTypes: true })) {
    const file = `${folder}/${item.name}`;
    if (item.isDirectory()) await scan(file);
    else if (/\.(ts|html)$/.test(file)) {
      const text = await readFile(file, 'utf8');
      assert(!/\beval\s*\(|new Function\s*\(/.test(text), `${file}: dynamic code evaluation`);
      assert(!/nodeIntegration:\s*true|sandbox:\s*false|webSecurity:\s*false/.test(text), `${file}: insecure window setting`);
      assert(!/[\u201c\u201d]/.test(text), `${file}: curly quote`);
    }
  }
}
await scan('src');
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
for (const [name, pkg] of Object.entries(lock.packages)) if (name) {
  assert(pkg.resolved.startsWith('https://registry.npmjs.org/'), `unapproved registry: ${name}`);
  assert(pkg.integrity.startsWith('sha512-'), `missing integrity: ${name}`);
}
console.log('Source policy and locked package integrity checks exited 0.');
