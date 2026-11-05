import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } from 'electron';
import { readFile, lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Documents } from './documents.js';
import { DeskError, failure, type OpenRequest } from '../shared/contracts.js';
import { FileWrites } from './files.js';
import { Preferences } from './settings.js';
import { prepareSaveText } from '../shared/document.js';
import { Folders } from './folders.js';
import { FileActions } from './actions.js';

const profile = process.argv.find(arg => arg.startsWith('--profile='))?.slice(10);
if (profile) app.setPath('userData', path.resolve(profile));
app.setName('text-desk');
protocol.registerSchemesAsPrivileged([{ scheme: 'desk', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const docs = new Documents();
const writes = new FileWrites();
const folders = new Folders(docs);
const actions = new FileActions(docs, file => shell.trashItem(file));
let closeApproved = false;
const pending = new Set<Promise<unknown>>();
let window: BrowserWindow | null = null;
const requestedPath = process.argv.find(arg => arg.startsWith('--open='))?.slice(7);
const replyId = process.argv.find(arg => arg.startsWith('--reply-id='))?.slice(11);
const pendingOpens: { file: string; replyId?: string }[] = [];
let routePending = () => {};
function replyPath(id: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
    ? path.join(app.getPath('userData'), '.cli-replies', `${id}.json`) : null;
}
async function writeReply(id: string | undefined, value: object) {
  if (!id) return;
  const file = replyPath(id);
  if (!file) return;
  const folder = path.dirname(file);
  await mkdir(folder, { recursive: true });
  if ((await lstat(folder)).isSymbolicLink()) return;
  await writeFile(file, JSON.stringify(value), { flag: 'wx' });
}
function launchReply(value: object) { process.stdout.write(`TEXT_DESK_READY:${JSON.stringify(value)}\n`); }
if (!app.requestSingleInstanceLock()) {
  void (async () => {
    const file = replyId ? replyPath(replyId) : null;
    if (file) {
      for (let attempt = 0; attempt < 360; attempt++) {
        try { launchReply(JSON.parse(await readFile(file, 'utf8'))); break; }
        catch { await new Promise(resolve => setTimeout(resolve, 25)); }
      }
    }
    app.quit();
  })();
}
else {
  if (requestedPath) pendingOpens.push({ file: requestedPath });
  app.on('second-instance', (_event, argv) => {
    window?.show(); window?.focus();
    const file = argv.find(arg => arg.startsWith('--open='))?.slice(7);
    const id = argv.find(arg => arg.startsWith('--reply-id='))?.slice(11);
    if (file) { pendingOpens.push({ file, replyId: id }); routePending(); }
  });
  app.whenReady().then(async () => {
    let rendererReady = false;
    let awaitingOpen = false;
    let routing = false;
    routePending = () => { void (async () => {
      if (routing || !rendererReady || !window) return;
      routing = true;
      try {
        while (pendingOpens.length && window) {
          const item = pendingOpens.shift()!;
          try {
            const info = await lstat(item.file);
            const request: OpenRequest = info.isDirectory()
              ? { kind: 'folder', view: await folders.select(item.file) }
              : { kind: 'file', view: await docs.select(item.file) };
            if (!item.replyId) awaitingOpen = true;
            window.webContents.send('desk:open-requested', request);
            window.show(); window.focus();
            await writeReply(item.replyId, { window: 'running' });
          } catch (error) {
            const result = failure(error);
            const rejected = { error: { code: result.code, message: result.message } };
            if (item.replyId) await writeReply(item.replyId, rejected).catch(() => {});
            else {
              launchReply(rejected);
              closeApproved = true;
              app.quit();
              return;
            }
          }
        }
      } finally { routing = false; }
    })(); };
    function fromWindow(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
      return event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === 'desk://app/index.html';
    }
    ipcMain.on('desk:renderer-ready', event => {
      if (!fromWindow(event)) return;
      rendererReady = true;
      routePending();
    });
    ipcMain.on('desk:open-applied', event => {
      if (!fromWindow(event) || !awaitingOpen) return;
      awaitingOpen = false;
      window?.show(); window?.focus();
      launchReply({ window: 'started' });
    });
    const preferences = new Preferences(app.getPath('userData'));
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'file://*/*', 'ftp://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
    protocol.handle('desk', async request => {
      try {
        const url = new URL(request.url);
        if (!['GET', 'HEAD'].includes(request.method)) return new Response('', { status: 405 });
        if (url.host === 'asset') {
          const parts = url.pathname.split('/').filter(Boolean);
          const asset = await docs.asset(parts[0], url.searchParams.get('path'));
          return new Response(new Uint8Array(asset.bytes), { headers: { 'content-type': asset.mime, 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff' } });
        }
        if (url.host !== 'app') return new Response('', { status: 403 });
        const files: Record<string, [string, string]> = {
          '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'],
          '/app.js': ['app.js', 'text/javascript'], '/markdown-view.js': ['markdown-view.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'],
          '/markdown.js': ['markdown.js', 'text/javascript'],
          '/sidebar.js': ['sidebar.js', 'text/javascript'],
          '/themes.js': ['themes.js', 'text/javascript'], '/themes.css': ['themes.css', 'text/css']
        };
        const item = files[url.pathname];
        if (!item) return new Response('', { status: 404 });
        return new Response(new Uint8Array(await readFile(path.join(__dirname, '../renderer', item[0]))), { headers: {
          'content-type': `${item[1]}; charset=utf-8`,
          'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src desk://asset; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'",
          'X-Content-Type-Options': 'nosniff'
        } });
      } catch { return new Response('', { status: 403 }); }
    });
    function handle(channel: string, action: (...args: unknown[]) => Promise<unknown>) {
      ipcMain.handle(channel, async (event, ...args: unknown[]) => {
        try {
          if (!fromWindow(event)) throw new DeskError('sender', 'This request is not allowed.');
          return { ok: true, value: await action(...args) };
        } catch (error) { return failure(error); }
      });
    }
    handle('desk:open-file', async () => {
      const picked = await dialog.showOpenDialog(window!, { properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] });
      if (picked.canceled || !picked.filePaths[0]) return null;
      return docs.select(picked.filePaths[0]);
    });
    handle('desk:read', id => docs.read(id));
    handle('desk:open-folder', async () => {
      const picked = await dialog.showOpenDialog(window!, { properties: ['openDirectory'] });
      return picked.canceled || !picked.filePaths[0] ? null : folders.select(picked.filePaths[0]);
    });
    handle('desk:list-folder', id => folders.list(id));
    handle('desk:open-entry', id => folders.open(id));
    handle('desk:rename', (id, name, expected) => tracked(actions.rename(id, name, expected)));
    handle('desk:trash', (id, expected) => tracked(actions.trash(id, expected)));
    handle('desk:settings', async () => preferences.read());
    handle('desk:set-settings', async value => preferences.write(value));
    function textArgument(value: unknown): string {
      if (typeof value !== 'string' || value.includes('\0')) throw new DeskError('text', 'This text cannot be saved.');
      return value;
    }
    async function tracked<T>(operation: Promise<T>): Promise<T> {
      pending.add(operation);
      try { return await operation; } finally { pending.delete(operation); }
    }
    handle('desk:save', async (id, expected, text) => {
      const grant = docs.get(id);
      await docs.checked(grant);
      if (typeof expected !== 'string') throw new DeskError('revision', 'Reload the file before saving.');
      return tracked(writes.save(grant, expected, textArgument(text)));
    });
    handle('desk:save-copy', async (id, draft) => {
      const grant = docs.get(id);
      const text = prepareSaveText('', textArgument(draft));
      const picked = await dialog.showSaveDialog(window!, { defaultPath: path.join(path.dirname(grant.path), `${path.basename(grant.path, path.extname(grant.path))}-copy.md`), filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] });
      if (picked.canceled || !picked.filePath) return null;
      if (!/\.(md|markdown)$/i.test(picked.filePath)) throw new DeskError('unsupported', 'Save the copy with .md or .markdown at the end.');
      return tracked(writes.saveCopy(docs, grant, picked.filePath, text));
    });
    handle('desk:link', async (id, href) => {
      if (typeof href !== 'string') throw new DeskError('link', 'This link cannot open here.');
      if (/^https?:\/\//i.test(href)) { const url = new URL(href); if (url.username || url.password) throw new DeskError('link', 'Links with embedded credentials cannot open here.'); await shell.openExternal(url.href); return null; }
      return docs.select(await docs.localPath(id, href), docs.get(id).root);
    });
    window = new BrowserWindow({ width: 1280, height: 800, minWidth: 800, minHeight: 550, backgroundColor: '#1c1b1a', title: 'text-desk', webPreferences: { preload: path.join(__dirname, '../preload/index.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('close', event => {
      if (!closeApproved) { event.preventDefault(); window?.webContents.send('desk:close-requested'); }
    });
    ipcMain.on('desk:confirm-close', async event => {
      if (!fromWindow(event)) return;
      await Promise.allSettled([...pending]);
      closeApproved = true;
      window?.close();
    });
    window.on('closed', () => { window = null; });
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'text-desk', submenu: [{ role: 'quit' }] }, { role: 'editMenu' }, { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] }]));
    await window.loadURL('desk://app/index.html');
  }).catch(error => { launchReply({ error: { code: 'launch-failed', message: 'The app could not start.' } }); console.error('App startup failed:', String(error)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
}
