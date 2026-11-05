import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DeskError, type DocumentView } from '../shared/contracts.js';

export interface Grant {
  id: string;
  path: string;
  root: string;
}
export function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
export function revision(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export function decode(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('binary');
    return text;
  } catch { throw new DeskError('encoding', 'This file is not supported UTF-8 text. It has not been changed.'); }
}
export async function regularBytes(file: string): Promise<Buffer> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new DeskError('file-type', 'Only regular files can open here.');
    return await handle.readFile();
  } finally { await handle.close(); }
}
export class Documents {
  readonly grants = new Map<string, Grant>();
  get(id: unknown): Grant {
    if (typeof id !== 'string' || !this.grants.has(id)) throw new DeskError('grant', 'Open the file again to access it.');
    return this.grants.get(id)!;
  }
  async checked(grant: Grant): Promise<string> {
    const canonical = await realpath(grant.path);
    if (!within(grant.root, canonical)) throw new DeskError('outside', 'This path is outside the open folder. Select the file explicitly.');
    return canonical;
  }
  async select(file: string, allowedRoot?: string): Promise<DocumentView> {
    const canonical = await realpath(file);
    if (!/\.(md|markdown)$/i.test(canonical)) throw new DeskError('unsupported', 'Only Markdown files open here for now.');
    const root = allowedRoot ?? path.dirname(canonical);
    if (!within(root, canonical)) throw new DeskError('outside', 'Select this file explicitly to open it outside the current folder.');
    const existing = [...this.grants.values()].find(grant => grant.path === canonical && grant.root === root);
    const grant = existing ?? { id: randomUUID(), path: canonical, root };
    const view = await this.view(grant);
    this.grants.set(grant.id, grant);
    return view;
  }
  async view(grant: Grant): Promise<DocumentView> {
    const file = await this.checked(grant);
    const bytes = await regularBytes(file);
    const info = await stat(file);
    return { id: grant.id, name: path.basename(file), location: path.relative(grant.root, file), text: decode(bytes), revision: revision(bytes), writable: info.nlink === 1 && (info.mode & 0o222) !== 0 };
  }
  async read(id: unknown): Promise<DocumentView> { return this.view(this.get(id)); }
  async localPath(id: unknown, href: unknown): Promise<string> {
    const grant = this.get(id);
    if (typeof href !== 'string' || href.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(href)) throw new DeskError('link', 'This local path cannot open here.');
    let decoded: string;
    try { decoded = decodeURIComponent(href.split(/[?#]/)[0]!); } catch { throw new DeskError('link', 'The link has an invalid path.'); }
    const target = path.resolve(path.dirname(await this.checked(grant)), decoded);
    if (!within(grant.root, target)) throw new DeskError('outside', 'This path is outside the open folder. Select it explicitly.');
    const canonical = await realpath(target);
    if (!within(grant.root, canonical)) throw new DeskError('outside', 'This link points outside the open folder. Select it explicitly.');
    return canonical;
  }
  async asset(id: unknown, href: unknown): Promise<{ bytes: Buffer; mime: string }> {
    const file = await this.localPath(id, href);
    const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
    const mime = types[path.extname(file).toLowerCase()];
    if (!mime) throw new DeskError('image', 'This image format is not supported.');
    return { bytes: await regularBytes(file), mime };
  }
}
