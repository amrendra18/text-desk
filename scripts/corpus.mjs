import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const manifestPath = '.local/planning/corpus.json';
const corpusSize = 31;
const sections = [
  'Plain text with **bold**, *italic*, `inline code`, and ~~struck~~ words.\n',
  '- First item\n- Second item\n  - Nested item\n',
  '1. One\n2. Two\n3. Three\n',
  '- [x] Finished task\n- [ ] Open task\n',
  '| Name | State |\n| --- | --- |\n| Alpha | Ready |\n| Beta | Waiting |\n',
  '```js\nconst answer = 42;\nconsole.log(answer);\n```\n',
  '> A quoted line.\n>\n> A second quoted line.\n',
  '[A related note](sample-01.md) and [a web link](https://example.invalid/page).\n',
  'Words in other scripts: café, 日本語, Русский, and \u{1F4DD}.\n',
  'HTML stays as plain text: <b>not bold</b>.\n',
  `${'A long line runs on without a manual break. '.repeat(40).trim()}\n`,
  '## Repeated heading\n\nFirst part.\n\n## Repeated heading\n\nSecond part.\n',
];

export async function readCorpusManifest(root) {
  let text;
  try { text = await readFile(path.join(root, manifestPath), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const files = JSON.parse(text).sources.flatMap(source => source.files);
  if (files.length !== corpusSize) throw new Error(`${manifestPath} must list exactly ${corpusSize} files. It lists ${files.length}.`);
  return files;
}

export async function writeSampleCorpus(folder) {
  await mkdir(folder, { recursive: true });
  const files = [];
  for (let index = 0; index < corpusSize; index++) {
    const file = path.join(folder, `sample-${String(index + 1).padStart(2, '0')}.md`);
    const parts = [0, 5, 10].map(offset => sections[(index + offset) % sections.length]);
    await writeFile(file, `# Sample note ${index + 1}\n\n${parts.join('\n')}`);
    files.push({ path: file });
  }
  return files;
}
