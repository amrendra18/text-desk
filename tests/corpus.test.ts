import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decode } from '../src/main/documents.js';

const scripts = path.resolve(__dirname, '../../scripts');
const corpusModule = () => import(pathToFileURL(path.join(scripts, 'corpus.mjs')).href);

async function scratch(run: (folder: string) => Promise<void>) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'text-desk-corpus-'));
  try { await run(folder); } finally { await rm(folder, { recursive: true, force: true }); }
}

test('corpus-sample builds 31 readable notes when no manifest exists', async () => {
  await scratch(async folder => {
    const { readCorpusManifest, writeSampleCorpus } = await corpusModule();
    assert.equal(await readCorpusManifest(folder), null);
    const files: { path: string }[] = await writeSampleCorpus(path.join(folder, 'sample'));
    assert.equal(files.length, 31);
    assert.equal(new Set(files.map(file => path.basename(file.path))).size, 31);
    const texts = new Set<string>();
    for (const file of files) {
      assert.equal(path.dirname(file.path), path.join(folder, 'sample'));
      const text = decode(await readFile(file.path));
      assert.match(text, /^# Sample note \d+\n/);
      assert.equal(text.includes('\r'), false);
      assert.equal(text.startsWith('﻿'), false);
      texts.add(text);
    }
    assert.equal(texts.size, 31);
  });
});

test('corpus-manifest is used when present and stops on a wrong count', async () => {
  await scratch(async folder => {
    const { readCorpusManifest } = await corpusModule();
    const manifest = path.join(folder, '.local/planning/corpus.json');
    await mkdir(path.dirname(manifest), { recursive: true });
    const write = (count: number) => writeFile(manifest, JSON.stringify({
      sources: [{ files: Array.from({ length: count }, (_, index) => ({ path: `/example/note-${index}.md` })) }]
    }));
    await write(31);
    assert.equal((await readCorpusManifest(folder)).length, 31);
    await write(30);
    await assert.rejects(readCorpusManifest(folder), /exactly 31 files/);
    await writeFile(manifest, 'not JSON');
    await assert.rejects(readCorpusManifest(folder), SyntaxError);
  });
});
