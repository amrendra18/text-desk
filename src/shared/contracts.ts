import type { FolderTree } from './folders.js';
export type Failure = { ok: false; code: string; message: string };
export type Result<T> = { ok: true; value: T } | Failure;
export interface DocumentView {
  id: string;
  name: string;
  location: string;
  text: string;
  revision: string;
  writable: boolean;
}
export type Theme = 'ember' | 'graphite' | 'midnight' | 'plum' | 'paper' | 'system';
export interface Settings { autosave: boolean; theme: Theme; notice?: string }
export type OpenRequest = { kind: 'file'; view: DocumentView } | { kind: 'folder'; view: FolderTree };
export interface DeskApi {
  openFile(): Promise<Result<DocumentView | null>>;
  read(id: string): Promise<Result<DocumentView>>;
  link(id: string, href: string): Promise<Result<DocumentView | null>>;
  save(id: string, revision: string, text: string): Promise<Result<{ text: string; revision: string }>>;
  saveCopy(id: string, text: string): Promise<Result<DocumentView | null>>;
  settings(): Promise<Result<Settings>>;
  setSettings(settings: Settings): Promise<Result<Settings>>;
  onCloseRequested(callback: () => void): void;
  confirmClose(): void;
  onOpenRequested(callback: (request: OpenRequest) => void): void;
  confirmOpen(): void;
  rendererReady(): void;
  openFolder(): Promise<Result<FolderTree | null>>;
  listFolder(id: string): Promise<Result<FolderTree>>;
  openEntry(id: string): Promise<Result<DocumentView>>;
  rename(id: string, name: string, revision: string): Promise<Result<DocumentView>>;
  trash(id: string, revision: string): Promise<Result<void>>;
}
export function failure(error: unknown): Failure {
  if (error instanceof DeskError) return { ok: false, code: error.code, message: error.message };
  const code = (error as { code?: string })?.code;
  const messages: Record<string, string> = {
    ENOENT: 'The file is no longer here. Open it again or choose another file.',
    EACCES: 'Permission was denied. Check the file permissions and try again.',
    EPERM: 'Your Mac did not allow this operation. Check permissions and try again.',
    EEXIST: 'A file with that name already exists. Choose another name.',
    ENOSPC: 'The disk is full. Free some space and try again.',
    EISDIR: 'Choose a Markdown file, not a folder.'
  };
  return { ok: false, code: code ?? 'unknown', message: messages[code ?? ''] ?? 'The operation failed. Your draft has been kept. Try again.' };
}
export class DeskError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
