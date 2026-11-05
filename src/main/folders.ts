import { randomUUID } from 'node:crypto';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { DeskError, type DocumentView } from '../shared/contracts.js';
import type { FolderEntry, FolderTree } from '../shared/folders.js';
import { Documents, within } from './documents.js';

interface EntryGrant {
  id: string;
  path: string;
  root: string;
  ancestors: string[];
}

export class Folders {
  private readonly grants = new Map<string, EntryGrant>();
  private readonly identities = new Map<string, string>();

  constructor(private readonly documents: Documents) {}

  private grant(file: string, root: string, ancestors: string[]): EntryGrant {
    const key = `${root}\0${file}`;
    const existing = this.identities.get(key);
    if (existing) return this.grants.get(existing)!;
    const entry = { id: randomUUID(), path: file, root, ancestors };
    this.identities.set(key, entry.id);
    this.grants.set(entry.id, entry);
    return entry;
  }

  private get(id: unknown): EntryGrant {
    if (typeof id !== 'string' || !this.grants.has(id)) {
      throw new DeskError('folder-grant', 'Open the folder again to access this entry.');
    }
    return this.grants.get(id)!;
  }

  private async checked(entry: EntryGrant): Promise<string> {
    const canonical = await realpath(entry.path);
    if (!within(entry.root, canonical)) {
      throw new DeskError('outside', 'This link points outside the open folder. Select it explicitly.');
    }
    return canonical;
  }

  async select(folder: string): Promise<FolderTree> {
    let canonical: string;
    try { canonical = await realpath(folder); }
    catch (error) { throw this.folderError(error); }
    const entry = this.grant(canonical, canonical, []);
    return this.list(entry.id);
  }

  async list(directoryId: unknown): Promise<FolderTree> {
    const parent = this.get(directoryId);
    try {
      const canonical = await this.checked(parent);
      const info = await stat(canonical);
      if (!info.isDirectory()) throw new DeskError('folder-type', 'Choose a folder to list its files.');
      if (parent.ancestors.includes(canonical)) {
        throw new DeskError('folder-cycle', 'This linked folder leads back to an open parent folder.');
      }
      if ((info.mode & 0o444) === 0 || (info.mode & 0o111) === 0) {
        throw new DeskError('folder-permission', 'This folder cannot be read. Check its permissions, then retry.');
      }
      const names = await readdir(canonical);
      const entries: FolderEntry[] = [];
      for (const name of names) {
        const entry = this.grant(path.join(parent.path, name), parent.root, [...parent.ancestors, canonical]);
        let linked = false;
        try {
          const original = await lstat(entry.path);
          linked = original.isSymbolicLink();
          const resolved = await this.checked(entry);
          const current = linked ? await stat(resolved) : original;
          const kind = current.isDirectory() ? 'directory'
            : current.isFile() && /\.(md|markdown)$/i.test(name) && /\.(md|markdown)$/i.test(resolved) ? 'markdown' : 'unsupported';
          entries.push({
            id: entry.id, name, kind, linked,
            ...(kind === 'unsupported' ? { notice: 'Only Markdown files open here for now.' } : {})
          });
        } catch (error) {
          const message = error instanceof DeskError ? error.message : 'This entry is unavailable. Refresh the folder or select it again.';
          entries.push({ id: entry.id, name, kind: 'unsupported', linked, notice: message });
        }
      }
      entries.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory')
        || a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }) || a.name.localeCompare(b.name, 'en'));
      return { id: parent.id, name: path.basename(parent.path) || parent.path, entries };
    } catch (error) { throw this.folderError(error); }
  }

  async open(entryId: unknown): Promise<DocumentView> {
    const entry = this.get(entryId);
    const canonical = await this.checked(entry);
    if (!/\.(md|markdown)$/i.test(entry.path) || !/\.(md|markdown)$/i.test(canonical) || !(await stat(canonical)).isFile()) {
      throw new DeskError('unsupported', 'Only Markdown files open here for now.');
    }
    return this.documents.select(canonical, entry.root);
  }

  private folderError(error: unknown): unknown {
    if (error instanceof DeskError) return error;
    const code = (error as { code?: string })?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return new DeskError('folder-missing', 'This folder is no longer here. Open it again or choose another folder.');
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return new DeskError('folder-permission', 'This folder cannot be read. Check its permissions, then retry.');
    }
    return error;
  }
}
