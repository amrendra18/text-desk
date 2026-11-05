import type { Stats } from 'node:fs';
import { link, lstat, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { DeskError, type DocumentView } from '../shared/contracts.js';
import { Documents, regularBytes, revision, type Grant } from './documents.js';
import { thisUserCanWrite } from './files.js';

interface ActionOperations {
  link?: typeof link;
  unlink?: typeof unlink;
}

export class FileActions {
  private readonly link: typeof link;
  private readonly unlink: typeof unlink;

  constructor(
    private readonly documents: Documents,
    private readonly trashItem: (file: string) => Promise<void>,
    operations: ActionOperations = {}
  ) {
    this.link = operations.link ?? link;
    this.unlink = operations.unlink ?? unlink;
  }

  private async checked(id: unknown, expectedRevision: unknown): Promise<{ grant: Grant; view: DocumentView }> {
    const grant = this.documents.get(id);
    if (typeof expectedRevision !== 'string' || !/^[0-9a-f]{64}$/.test(expectedRevision)) {
      throw new DeskError('revision', 'Reload the file before changing it.');
    }
    const info = await lstat(grant.path);
    if (!info.isFile() || info.isSymbolicLink()) throw new DeskError('file-type', 'Only regular Markdown files can be changed here.');
    if (info.nlink !== 1) throw new DeskError('hard-link', 'This file has another hard link. Open a separate copy before changing it.');
    if ((info.mode & 0o222) === 0 || !(await thisUserCanWrite(grant.path))) throw new DeskError('read-only', 'This file is read-only. Check its permissions before changing it.');
    const file = await this.documents.checked(grant);
    if (!/\.(md|markdown)$/i.test(file)) throw new DeskError('unsupported', 'Only Markdown files can be changed here.');
    if (revision(await regularBytes(file)) !== expectedRevision) {
      throw new DeskError('outside-change', 'This file changed outside text-desk. Reload it before renaming or moving it to Trash.');
    }
    const view = await this.documents.view(grant);
    if (view.revision !== expectedRevision) {
      throw new DeskError('outside-change', 'This file changed outside text-desk. Reload it before renaming or moving it to Trash.');
    }
    return { grant, view };
  }

  async rename(id: unknown, newName: unknown, expectedRevision: unknown): Promise<DocumentView> {
    if (typeof newName !== 'string' || !newName.trim() || newName === '.' || newName === '..'
      || /[/\\:\u0000-\u001f\u007f]/.test(newName) || !/\.(md|markdown)$/i.test(newName)) {
      throw new DeskError('rename-name', 'Enter a Markdown filename without slashes, colons, or control characters.');
    }
    const { grant, view } = await this.checked(id, expectedRevision);
    const source = grant.path;
    const target = path.join(path.dirname(source), newName);
    if (target === source) return view;
    const original = await lstat(source);
    if (await this.sameEntry(source, target, original)) await rename(source, target);
    else await this.renameByLink(source, target, original);
    for (const current of this.documents.grants.values()) {
      if (current.path === source) current.path = target;
    }
    return { ...view, name: newName, location: path.relative(grant.root, target) };
  }

  // A case-insensitive disk resolves a letter-case variant of the name to the
  // same entry, so an exclusive link would always fail with EEXIST.
  private async sameEntry(source: string, target: string, original: Stats): Promise<boolean> {
    if (path.basename(source).toLowerCase() !== path.basename(target).toLowerCase()) return false;
    try {
      const existing = await lstat(target);
      return existing.dev === original.dev && existing.ino === original.ino;
    } catch (error) {
      if ((error as { code?: string })?.code === 'ENOENT') return false;
      throw error;
    }
  }

  private async renameByLink(source: string, target: string, original: Stats): Promise<void> {
    await this.link(source, target);
    try { await this.unlink(source); }
    catch (error) {
      try {
        const created = await lstat(target);
        if (created.dev === original.dev && created.ino === original.ino) await this.unlink(target);
      } catch (cleanupError) {
        if ((cleanupError as { code?: string })?.code !== 'ENOENT') {
          throw new DeskError('rename-cleanup', 'Rename could not finish. The original remains, and a second name may exist. Refresh the folder.');
        }
      }
      throw error;
    }
  }

  async trash(id: unknown, expectedRevision: unknown): Promise<void> {
    const { grant } = await this.checked(id, expectedRevision);
    const source = grant.path;
    await this.trashItem(source);
    for (const [key, current] of this.documents.grants) {
      if (current.path === source) this.documents.grants.delete(key);
    }
  }
}
