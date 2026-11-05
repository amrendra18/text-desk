import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const sentence = 'A long Markdown line runs across the pane because its author never pressed return while writing this paragraph. ';
const codeLine = `const command = [${Array.from({ length: 40 }, (_, index) => `'argument-${index}'`).join(', ')}];`;
const example = `# Reading width

${sentence.repeat(5).trim()}

\`\`\`js
${codeLine}
const short = 1;
\`\`\`

| Feature | Reference | Archive folder | Result | Notes |
| --- | --- | --- | --- | --- |
| Appearance | guides/theme-selection.md | archive/0123456789abcdefghijklmnopqrstuvwxyz | ready | Colors match the chosen theme |
| Command open | guides/command-line.md | archive/abcdefghijklmnopqrstuvwxyz0123456789 | ready | The command opens the file in the app |

| Step | Reference | Screen |
| --- | --- | --- |
| Install the app | https://example.com/docs/guides/getting-started/installation/macos/troubleshooting/permissions-and-signing | ![small](reading-small.png) |
| Open a note | https://example.com/docs/guides/getting-started/installation/macos/troubleshooting/permissions-and-signing/second | ![wide](reading-wide.png) |
`;
const allWindows = [800, 1000, 1280, 1440, 1728, 2560];
const readSideSpace = 96;
const splitSideSpace = 68;
const smallImage = { width: 120, height: 60 };
const wideImage = { width: 3000, height: 400 };
const narrowestWideImage = 439;

function grayPng({ width, height }) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8;
  const row = Buffer.alloc(width + 1, 128); row[0] = 0;
  const pixels = deflateSync(Buffer.concat(Array(height).fill(row)));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
}

function measureLayout() {
  const pane = document.querySelector('.preview-wrap');
  const preview = document.querySelector('#preview');
  const paragraph = preview.querySelector('p');
  const pre = preview.querySelector('pre');
  const paragraphText = paragraph.firstChild;
  const range = document.createRange();
  const lineTop = index => { range.setStart(paragraphText, index); range.setEnd(paragraphText, index + 1); return range.getBoundingClientRect().top; };
  const firstLine = lineTop(0);
  let charsPerLine = 0;
  while (charsPerLine < paragraphText.length && Math.abs(lineTop(charsPerLine) - firstLine) < 1) charsPerLine++;
  const textBox = paragraph.getBoundingClientRect();
  const canScroll = block => ['auto', 'scroll'].includes(getComputedStyle(block).overflowX);
  const tableFacts = table => {
    const block = table.closest('#preview > *');
    const brokenWords = [];
    const cells = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
    while (cells.nextNode()) {
      for (const word of cells.currentNode.data.matchAll(/[\p{L}\p{N}]+/gu)) {
        range.setStart(cells.currentNode, word.index);
        range.setEnd(cells.currentNode, word.index + word[0].length);
        if (range.getClientRects().length > 1) brokenWords.push(word[0]);
      }
    }
    return { width: Math.round(table.getBoundingClientRect().width), block_width: Math.round(block.getBoundingClientRect().width), inside_text: block.getBoundingClientRect().right <= textBox.right + 1, reachable: block.scrollWidth <= block.clientWidth || canScroll(block), broken_words: brokenWords };
  };
  return {
    window: innerWidth,
    pane: pane.clientWidth,
    text: Math.round(textBox.width),
    side_space: Math.round(pane.clientWidth - textBox.width),
    chars_per_line: charsPerLine,
    page_scrolls_sideways: pane.scrollWidth > pane.clientWidth,
    code: { width: Math.round(pre.getBoundingClientRect().width), inside_text: pre.getBoundingClientRect().right <= textBox.right + 1, scrolls_inside: pre.scrollWidth > pre.clientWidth && canScroll(pre) },
    tables: [...preview.querySelectorAll('table')].map(tableFacts),
    images: Object.fromEntries([...preview.querySelectorAll('table img')].map(image => [image.alt, { width: Math.round(image.getBoundingClientRect().width), height: Math.round(image.getBoundingClientRect().height) }]))
  };
}

export async function verifyReading({ electron, page, scratch, evidence, check, openFile }) {
  const fixture = path.join(scratch, 'reading-width.md');
  await writeFile(fixture, example);
  await writeFile(path.join(scratch, 'reading-small.png'), grayPng(smallImage));
  await writeFile(path.join(scratch, 'reading-wide.png'), grayPng(wideImage));
  const rows = [];
  const startSize = await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize());

  async function resize(width) {
    const actual = await electron.evaluate(({ BrowserWindow }, [wanted, height]) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(wanted, height);
      return window.getContentSize()[0];
    }, [width, startSize[1]]);
    await page.waitForFunction(expected => innerWidth === expected, actual);
  }
  async function record(mode, width) {
    await resize(width);
    const screenshot = `screens/reading-width-${mode}-${width}.png`;
    await page.screenshot({ path: path.join(evidence, screenshot) });
    await page.locator('#preview table img').last().scrollIntoViewIfNeeded();
    const imagesScreenshot = `screens/reading-width-${mode}-${width}-images.png`;
    await page.screenshot({ path: path.join(evidence, imagesScreenshot) });
    await page.locator('#preview').evaluate(preview => preview.closest('.preview-wrap').scrollTo(0, 0));
    const row = { mode, requested_window: width, ...await page.evaluate(measureLayout), screenshot, images_screenshot: imagesScreenshot };
    rows.push(row);
    return row;
  }

  await check('reading-width', async () => {
    try {
      await openFile(fixture);
      await page.locator('#read-view').click();
      await page.waitForFunction(() => { const images = [...document.querySelectorAll('#preview table img')]; return images.length === 2 && images.every(image => image.complete && image.naturalWidth > 0); });
      for (const width of allWindows) await record('read', width);
      await page.locator('#raw-view').click();
      await page.locator('#editor').waitFor();
      for (const width of [1000, 1280, 1728]) await record('split', width);
    } finally {
      await writeFile(path.join(evidence, 'traces/reading-width.json'), JSON.stringify(rows, null, 2));
      await resize(startSize[0]);
    }
    for (const row of rows) {
      const label = `${row.mode} view at ${row.window} pixels`;
      assert.equal(row.page_scrolls_sideways, false, `${label}: the page scrolls sideways.`);
      assert.equal(row.code.inside_text, true, `${label}: the code block leaves the text column.`);
      assert.equal(row.code.scrolls_inside, true, `${label}: the long code line stopped scrolling inside its block.`);
      for (const table of row.tables) {
        assert.equal(table.inside_text, true, `${label}: a table leaves the text column.`);
        assert.equal(table.reachable, true, `${label}: part of a table cannot be scrolled into view.`);
        assert.deepEqual(table.broken_words, [], `${label}: table words split in the middle.`);
      }
      assert.deepEqual(row.images.small, smallImage, `${label}: the small table image changed size.`);
      assert(row.images.wide.width >= narrowestWideImage, `${label}: the wide table image shrank to ${row.images.wide.width} by ${row.images.wide.height} pixels.`);
      assert(Math.abs(row.images.wide.height - row.images.wide.width * wideImage.height / wideImage.width) <= 1, `${label}: the wide table image lost its shape.`);
      const expected = row.mode === 'read' ? readSideSpace : splitSideSpace;
      assert(row.side_space <= expected, `${label}: ${row.pane} pixel pane holds ${row.text} pixels of text, leaving ${row.side_space} pixels of side space. At most ${expected} is allowed.`);
    }
  });
}
