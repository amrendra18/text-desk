import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('heading-anchors give repeated headings unique names', async () => {
  Object.assign(globalThis, { marked: { use() {} } });
  const { anchorNames } = await import(pathToFileURL(path.resolve(__dirname, '../src/renderer/markdown-view.js')).href);
  const next: (heading: string) => string = anchorNames();
  assert.deepEqual(['Same', 'Same', 'Same-1', 'same', 'Other'].map(heading => next(heading)), ['md-same', 'md-same-1', 'md-same-1-1', 'md-same-2', 'md-other']);
  assert.equal(anchorNames()('Same'), 'md-same');
});
