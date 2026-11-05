import { contextBridge, ipcRenderer } from 'electron';
import type { DeskApi, OpenRequest } from '../shared/contracts.js';
const api: DeskApi = {
  openFile: () => ipcRenderer.invoke('desk:open-file'),
  read: id => ipcRenderer.invoke('desk:read', id),
  link: (id, href) => ipcRenderer.invoke('desk:link', id, href),
  save: (id, revision, text) => ipcRenderer.invoke('desk:save', id, revision, text),
  saveCopy: (id, text) => ipcRenderer.invoke('desk:save-copy', id, text),
  settings: () => ipcRenderer.invoke('desk:settings'),
  setSettings: settings => ipcRenderer.invoke('desk:set-settings', settings),
  onCloseRequested: callback => { ipcRenderer.on('desk:close-requested', () => callback()); },
  confirmClose: () => ipcRenderer.send('desk:confirm-close'),
  onOpenRequested: callback => { ipcRenderer.on('desk:open-requested', (_event, request: OpenRequest) => callback(request)); },
  confirmOpen: () => ipcRenderer.send('desk:open-applied'),
  rendererReady: () => ipcRenderer.send('desk:renderer-ready'),
  openFolder: () => ipcRenderer.invoke('desk:open-folder'),
  listFolder: id => ipcRenderer.invoke('desk:list-folder', id),
  openEntry: id => ipcRenderer.invoke('desk:open-entry', id),
  rename: (id, name, revision) => ipcRenderer.invoke('desk:rename', id, name, revision),
  trash: (id, revision) => ipcRenderer.invoke('desk:trash', id, revision)
};
contextBridge.exposeInMainWorld('desk', api);
