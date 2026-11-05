import type { DeskApi, DocumentView, OpenRequest, Settings } from '../shared/contracts.js';
import { escapeText, preview } from './markdown-view.js';
import { Sidebar } from './sidebar.js';
import { applyTheme, createThemePicker } from './themes.js';
declare global { interface Window { desk: DeskApi } }
const element = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const normalized = (text: string) => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
interface EditorSession { doc: DocumentView; draft: string; baseline: string; error: string | null }
let current: EditorSession | null = null;
let view: 'read' | 'raw' | 'edit' = 'read';
let busy = false;
let saving: Promise<boolean> | null = null;
let settings: Settings = { autosave: false, theme: 'ember' };
let autoTimer: ReturnType<typeof setTimeout> | undefined;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
const dirty = () => current !== null && current.draft !== current.baseline;
const sidebar = new Sidebar(window.desk, id => { void load(() => window.desk.openEntry(id)); }, message => notice(message));
function notice(message: string, recovery = false, retry?: () => void) {
  const banner = element('#banner');
  banner.replaceChildren(); banner.hidden = !message;
  if (!message) return;
  const label = document.createElement('p'); label.textContent = message; banner.append(label);
  if (recovery) {
    for (const [id, text, action] of [
      ['retry-save', 'Retry save', () => { if (current) current.error = null; void save(); }],
      ['reload-file', 'Reload', () => { void reload(); }],
      ['save-copy', 'Save copy', () => { void saveCopy(); }]
    ] as const) {
      const button = document.createElement('button'); button.id = id; button.textContent = text;
      button.addEventListener('click', action); banner.append(button);
    }
  } else if (retry) {
    const button = document.createElement('button'); button.textContent = 'Retry';
    button.addEventListener('click', retry); banner.append(button);
  }
}
function status() {
  const text = current?.draft ?? '';
  const state = busy ? 'Loading...' : saving ? 'Saving...' : current?.error ? 'Save paused' : dirty() ? 'Unsaved changes' : view === 'edit' ? 'Saved' : 'Read only';
  element('#status').textContent = current ? `${text.trim() ? text.trim().split(/\s+/).length : 0} words · ${text.split('\n').length} lines · ${state}` : 'Open a Markdown file to begin.';
  const saveButton = document.querySelector<HTMLButtonElement>('#save');
  if (saveButton) saveButton.disabled = busy || !!saving || !current?.doc.writable;
  element<HTMLButtonElement>('#open-file').disabled = busy;
  element<HTMLButtonElement>('#open-folder').disabled = busy;
  const editor = document.querySelector<HTMLTextAreaElement>('#editor');
  if (editor) editor.disabled = busy;
  document.title = current ? `${dirty() ? '* ' : ''}${current.doc.name} - text-desk` : 'text-desk';
}
function updatePreview() {
  clearTimeout(previewTimer);
  if (!current) return;
  element('#preview').replaceChildren(preview(current.draft, current.doc.id));
  if (!current.draft.trim()) element('#preview').innerHTML = '<p class="empty-note">This file is empty.</p>';
}
function scheduleSave() {
  clearTimeout(autoTimer);
  if (settings.autosave && dirty() && !current?.error && !busy) autoTimer = setTimeout(() => { void save(); }, 600);
}
function render() {
  const content = element('#content');
  if (!current) {
    element('#filebar').replaceChildren(); sidebar.setDocument('', '');
    content.className = 'content';
    content.innerHTML = '<section class="empty-state"><div class="inner"><div class="empty-mark">md</div><h1>A place for your words</h1><p>Open a Markdown file to read, explore, and edit.</p><button class="primary" id="welcome-open">Open file</button></div></section>';
    element('#welcome-open').addEventListener('click', openFile); status(); return;
  }
  const doc = current.doc;
  sidebar.setDocument(doc.name, doc.location);
  element('#filebar').innerHTML = `<div class="breadcrumb grow">${escapeText(doc.location)}</div><div class="views"><button id="read-view" aria-pressed="${view === 'read'}">Read</button><button id="raw-view" aria-pressed="${view === 'raw'}">Show source</button><button id="edit-view" aria-pressed="${view === 'edit'}" ${doc.writable ? '' : 'disabled'}>Edit</button></div><button id="save" class="primary">Save</button><div class="actions"><button id="file-actions" aria-label="File actions" aria-expanded="false">•••</button><div class="menu" id="file-menu" hidden><button id="rename-file">Rename</button><button id="trash-file" class="danger">Move to Trash</button></div></div>`;
  element('#file-actions').addEventListener('click', () => {
    const menu = element('#file-menu'); menu.hidden = !menu.hidden;
    element('#file-actions').setAttribute('aria-expanded', String(!menu.hidden));
  });
  element('#rename-file').addEventListener('click', () => { void fileAction('rename'); });
  element('#trash-file').addEventListener('click', () => { void fileAction('trash'); });
  for (const [id, mode] of [['read-view', 'read'], ['raw-view', 'raw'], ['edit-view', 'edit']] as const) {
    element('#' + id).addEventListener('click', () => { view = mode; render(); if (mode === 'edit') element('#editor').focus(); });
  }
  element('#save').addEventListener('click', () => { void save(); });
  content.className = `content${view !== 'read' ? ' split' : ''}`;
  content.innerHTML = '<section class="preview-wrap"><article class="document" id="preview" aria-label="Markdown preview"></article></section>';
  updatePreview();
  if (view !== 'read') {
    const pane = document.createElement('section'); pane.className = 'raw-pane';
    pane.innerHTML = `<div class="pane-label">Source <span>${view === 'edit' ? 'Editing' : 'Read only'}</span></div><textarea id="editor" aria-label="Markdown source" spellcheck="false" ${view === 'edit' ? '' : 'readonly'}></textarea>`;
    content.append(pane);
    const editor = element<HTMLTextAreaElement>('#editor'); editor.value = current.draft;
    editor.addEventListener('input', () => {
      if (!current) return;
      current.draft = editor.value;
      clearTimeout(previewTimer); previewTimer = setTimeout(updatePreview, 100);
      status(); scheduleSave();
    });
  }
  status();
}
function adopt(doc: DocumentView) {
  current = { doc, draft: normalized(doc.text), baseline: normalized(doc.text), error: null };
  if (view === 'edit' && !doc.writable) view = 'raw';
  clearTimeout(autoTimer); clearTimeout(previewTimer); notice('');
}
async function save(): Promise<boolean> {
  clearTimeout(autoTimer);
  if (saving) { await saving; if (!dirty()) return true; if (current?.error) return false; return save(); }
  if (!current) return true;
  const owner = current;
  const snapshot = owner.draft;
  owner.error = null; notice('');
  saving = (async () => {
    try {
      const result = await window.desk.save(owner.doc.id, owner.doc.revision, snapshot);
      if (!result.ok) { owner.error = result.message; notice(result.message, true); return false; }
      owner.doc.text = result.value.text; owner.doc.revision = result.value.revision;
      owner.baseline = normalized(result.value.text);
      return true;
    } catch { owner.error = 'The save failed. Your draft has been kept.'; notice(owner.error, true); return false; }
  })();
  status();
  const result = await saving;
  saving = null; status(); if (result) { updatePreview(); scheduleSave(); }
  return result;
}
function choose(dialogId: string, choices: Record<string, string>): Promise<string> {
  const dialog = element<HTMLDialogElement>(dialogId);
  return new Promise(resolve => {
    const controller = new AbortController();
    const finish = (value: string) => { controller.abort(); dialog.close(); resolve(value); };
    for (const [id, value] of Object.entries(choices)) element('#' + id).addEventListener('click', () => finish(value), { signal: controller.signal });
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish('cancel'); }, { signal: controller.signal });
    dialog.showModal();
  });
}
async function leave(): Promise<boolean> {
  clearTimeout(autoTimer);
  if (saving && !(await saving)) return false;
  if (!dirty()) return true;
  const choice = await choose('#guard-dialog', { 'guard-save': 'save', 'guard-discard': 'discard', 'guard-cancel': 'cancel' });
  if (choice === 'save') return save();
  return choice === 'discard';
}
async function load(action: () => ReturnType<DeskApi['openFile']>) {
  if (busy || element<HTMLDialogElement>('#guard-dialog').open) return;
  busy = true; status();
  try {
    if (!(await leave())) return;
    const result = await action();
    if (result.ok) { if (result.value) { adopt(result.value); render(); } }
    else notice(result.message, false, () => { void load(action); });
  } catch { notice('The app could not open the file. Try again.'); }
  finally { busy = false; status(); scheduleSave(); }
}
function openFile() {
  void load(async () => {
    const result = await window.desk.openFile();
    if (result.ok && result.value) sidebar.setFolder(null);
    return result;
  });
}
async function openFolder() {
  if (busy) return;
  busy = true; status();
  try {
    if (!(await leave())) return;
    const result = await window.desk.openFolder();
    if (result.ok) {
      if (result.value) { current = null; sidebar.setFolder(result.value); notice(''); render(); }
    } else notice(result.message);
  } finally { busy = false; status(); scheduleSave(); }
}
async function fileAction(action: 'rename' | 'trash') {
  if (busy || !current) return;
  element('#file-menu').hidden = true;
  busy = true; status();
  try {
    if (!(await leave()) || !current) return;
    if (action === 'rename') {
      element<HTMLInputElement>('#rename-input').value = current.doc.name;
      element('#rename-error').textContent = '';
      while (true) {
        const choice = choose('#rename-dialog', { 'rename-confirm': 'rename', 'rename-cancel': 'cancel' });
        element('#rename-input').focus();
        if (await choice !== 'rename') return;
        const result = await window.desk.rename(current.doc.id, element<HTMLInputElement>('#rename-input').value, current.doc.revision);
        if (result.ok) { adopt(result.value); await sidebar.refresh(); render(); return; }
        element('#rename-error').textContent = result.message;
      }
    } else {
      element('#trash-description').textContent = `Move ${current.doc.name} to your Mac's Trash? You can restore it from there.`;
      if (await choose('#trash-dialog', { 'trash-confirm': 'trash', 'trash-cancel': 'cancel' }) !== 'trash') return;
      const result = await window.desk.trash(current.doc.id, current.doc.revision);
      if (result.ok) { current = null; await sidebar.refresh(); notice(''); render(); }
      else notice(result.message, true);
    }
  } finally { busy = false; status(); scheduleSave(); }
}
async function reload() {
  if (busy || !current) return;
  busy = true; status(); clearTimeout(autoTimer);
  try {
    if (saving) await saving;
    if (dirty() && (await choose('#confirm-dialog', { 'confirm-yes': 'yes', 'confirm-no': 'cancel' })) !== 'yes') return;
    const result = await window.desk.read(current.doc.id);
    if (result.ok) { adopt(result.value); render(); } else notice(result.message, true);
  } finally { busy = false; status(); }
}
async function saveCopy() {
  if (busy || !current) return;
  busy = true; status(); clearTimeout(autoTimer);
  try {
    if (saving) await saving;
    const result = await window.desk.saveCopy(current.doc.id, current.draft);
    if (result.ok) { if (result.value) { sidebar.setFolder(null); adopt(result.value); render(); } }
    else notice(result.message, true);
  } finally { busy = false; status(); }
}
element('#open-file').addEventListener('click', openFile);
element('#open-folder').addEventListener('click', () => { void openFolder(); });
element('#refresh-folder').addEventListener('click', () => { void sidebar.refresh(); });
element('#settings').addEventListener('click', () => {
  element<HTMLInputElement>('#autosave').checked = settings.autosave;
  element('#theme-picker').replaceChildren(createThemePicker(settings.theme, theme => { void updateSettings({ theme }); }));
  element('#settings-error').hidden = true;
  element<HTMLDialogElement>('#settings-dialog').showModal();
});
element('#settings-close').addEventListener('click', () => element<HTMLDialogElement>('#settings-dialog').close());
async function updateSettings(change: Partial<Settings>) {
  const controls = [...document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#settings-dialog input, #settings-close')];
  for (const control of controls) control.disabled = true;
  try {
    const result = await window.desk.setSettings({ ...settings, ...change });
    if (result.ok) { settings = result.value; applyTheme(settings.theme); scheduleSave(); }
    else {
      element('#settings-error').textContent = result.message; element('#settings-error').hidden = false;
      element<HTMLInputElement>('#autosave').checked = settings.autosave;
      for (const radio of document.querySelectorAll<HTMLInputElement>('input[name=theme]')) radio.checked = radio.value === settings.theme;
    }
  } finally { for (const control of controls) control.disabled = false; }
}
element('#autosave').addEventListener('change', () => { void updateSettings({ autosave: element<HTMLInputElement>('#autosave').checked }); });
element('#content').addEventListener('click', event => {
  const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[data-href]');
  if (!anchor || !current) return;
  event.preventDefault(); const href = anchor.dataset.href!;
  if (href.startsWith('#')) {
    try { element('#preview').querySelector('#' + CSS.escape('md-' + decodeURIComponent(href.slice(1))))?.scrollIntoView(); }
    catch { notice('This link has an invalid destination.'); }
    return;
  }
  const id = current.doc.id;
  void load(() => window.desk.link(id, href));
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!busy && !document.querySelector('dialog[open]')) void save(); }
  if (event.key === 'Escape') {
    const menu = document.querySelector<HTMLElement>('#file-menu');
    if (menu && !menu.hidden) { menu.hidden = true; element('#file-actions').setAttribute('aria-expanded', 'false'); element('#file-actions').focus(); }
  }
  if (event.key === 'Enter' && event.target === document.querySelector('#rename-input')) { event.preventDefault(); element('#rename-confirm').click(); }
});
window.desk.onCloseRequested(() => {
  if (busy || document.querySelector('dialog[open]')) return;
  busy = true; status();
  void leave().then(allowed => { if (allowed) window.desk.confirmClose(); }).finally(() => { busy = false; status(); scheduleSave(); });
});
const openRequests: OpenRequest[] = [];
let applyingOpen = false;
async function applyOpenRequests() {
  if (applyingOpen) return;
  applyingOpen = true;
  try {
    while (openRequests.length) {
      while (busy) await new Promise(resolve => setTimeout(resolve, 20));
      const request = openRequests.shift()!;
      busy = true; status();
      try {
        if (await leave()) {
          if (request.kind === 'file') { sidebar.setFolder(null); adopt(request.view); }
          else { current = null; sidebar.setFolder(request.view); notice(''); }
          render();
        }
      } finally { busy = false; status(); window.desk.confirmOpen(); }
    }
  } finally { applyingOpen = false; }
}
window.desk.onOpenRequested(request => { openRequests.push(request); void applyOpenRequests(); });
render();
window.desk.rendererReady();
void window.desk.settings().then(result => {
  if (result.ok) { settings = result.value; applyTheme(settings.theme); if (settings.notice) notice(settings.notice); }
  else notice(result.message);
}).finally(() => { element<HTMLButtonElement>('#settings').disabled = false; });
