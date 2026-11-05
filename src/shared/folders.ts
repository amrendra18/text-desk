export interface FolderEntry {
  id: string;
  name: string;
  kind: 'directory' | 'markdown' | 'unsupported';
  linked: boolean;
  notice?: string;
}

export interface FolderTree {
  id: string;
  name: string;
  entries: FolderEntry[];
}
