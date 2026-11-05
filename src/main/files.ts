import { constants, type Stats } from 'node:fs';
import { execFile } from 'node:child_process';
import { access, lstat, open, realpath, rename, stat, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { decode, revision, within, type Documents, type Grant } from './documents.js';
import { DeskError, type DocumentView } from '../shared/contracts.js';
import { prepareSaveText, type SaveResult } from '../shared/document.js';

const operations = {
  copyWithAttributes: async (source: string, target: string) => { await promisify(execFile)('/bin/cp', ['-n', '--', source, target]); },
  write: (handle: FileHandle, bytes: Buffer) => handle.writeFile(bytes),
  replace: (source: string, destination: string) => rename(source, destination)
};

const orNull = <T>(pending: Promise<T>) => pending.catch((error: NodeJS.ErrnoException) => {
  if (error.code === 'ENOENT') return null;
  throw error;
});

const sameFileOnDisk = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;

export async function thisUserCanWrite(file: string): Promise<boolean> {
  try {
    await access(file, constants.W_OK);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return false;
    throw error;
  }
}

async function keepCreationDate(handle: FileHandle, created: Date) {
  await handle.utimes(created, created);
  const now = new Date();
  await handle.utimes(now, now);
}

async function snapshot(file: string) {
  const entry = await lstat(file);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new DeskError('file-type', 'Only regular files can be saved. Your draft has been kept.');
  }
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new DeskError('file-type', 'Only regular files can be saved. Your draft has been kept.');
    if (info.nlink !== 1) throw new DeskError('hard-link', 'This file has another linked name. Save a copy to keep your draft.');
    if ((info.mode & 0o222) === 0 || !(await thisUserCanWrite(file))) throw new DeskError('read-only', 'This file is read-only. Save a copy to keep your draft.');
    const bytes = await handle.readFile();
    const text = decode(bytes);
    return { info, bytes, text, revision: revision(bytes) };
  } finally { await handle.close(); }
}

export class FileWrites {
  private readonly pending = new Map<string, Promise<SaveResult>>();
  private readonly io: typeof operations;

  constructor(overrides: Partial<typeof operations> = {}) {
    this.io = { ...operations, ...overrides };
  }

  save(grant: Grant, expectedRevision: string, text: string): Promise<SaveResult> {
    const file = path.resolve(grant.path);
    const root = grant.root;
    const previous = this.pending.get(file);
    const next = (previous ?? Promise.resolve()).catch(() => undefined)
      .then(() => this.write(file, root, expectedRevision, text));
    this.pending.set(file, next);
    void next.finally(() => {
      if (this.pending.get(file) === next) this.pending.delete(file);
    }).catch(() => undefined);
    return next;
  }

  async saveCopy(documents: Documents, grant: Grant, destination: string, text: string): Promise<DocumentView> {
    const refusal = () => new DeskError('copy', 'Choose another file for the copy. Your original remains unchanged.');
    if (path.resolve(destination) === grant.path) throw refusal();
    const existing = await orNull(lstat(destination));
    if (existing?.isSymbolicLink()) throw new DeskError('copy-link', 'Choose a regular file or a new name for the copy.');
    if (existing) {
      const original = await orNull(stat(grant.path));
      if (original && sameFileOnDisk(original, existing)) throw refusal();
      const target = await documents.select(destination);
      await this.save(documents.get(target.id), target.revision, text);
    } else {
      const handle = await open(destination, 'wx', 0o600);
      try { await handle.writeFile(text, 'utf8'); await handle.sync(); }
      catch (error) { await handle.close(); await unlink(destination).catch(() => {}); throw error; }
      await handle.close();
    }
    return documents.select(destination);
  }

  private async temporaryFor(file: string, temporary: string): Promise<FileHandle> {
    try {
      await this.io.copyWithAttributes(file, temporary);
      return await open(temporary, constants.O_WRONLY | constants.O_TRUNC);
    } catch {
      await unlink(temporary).catch(() => {});
      return open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    }
  }

  private async write(file: string, root: string, expectedRevision: string, draft: string): Promise<SaveResult> {
    if (!within(root, file)) {
      throw new DeskError('outside', 'This file is outside the open folder. Select the file again.');
    }
    const before = await snapshot(file);
    if (!within(root, await realpath(file))) {
      throw new DeskError('outside', 'This file is outside the open folder. Select the file again.');
    }
    if (before.revision !== expectedRevision) {
      throw new DeskError('outside-change', 'The file changed outside text-desk. Reload it or save a copy of your draft.');
    }
    const text = prepareSaveText(before.text, draft);
    const bytes = Buffer.from(text, 'utf8');
    if (before.bytes.equals(bytes)) return { text, revision: before.revision };

    const temporary = path.join(path.dirname(file), `.text-desk-${randomUUID()}.tmp`);
    let owned = false;
    try {
      owned = true;
      const handle = await this.temporaryFor(file, temporary);
      try {
        await this.io.write(handle, bytes);
        await handle.chmod(before.info.mode & 0o7777);
        await keepCreationDate(handle, before.info.birthtime);
        await handle.sync();
      } finally { await handle.close(); }
      const current = await snapshot(file);
      if (current.revision !== before.revision || current.info.dev !== before.info.dev ||
          current.info.ino !== before.info.ino || current.info.mode !== before.info.mode) {
        throw new DeskError('outside-change', 'The file changed while saving. Reload it or save a copy of your draft.');
      }
      if (!within(root, await realpath(file))) {
        throw new DeskError('outside', 'This file is outside the open folder. Select the file again.');
      }
      await this.io.replace(temporary, file);
      owned = false;
      return { text, revision: revision(bytes) };
    } finally {
      if (owned) await unlink(temporary).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
  }
}
