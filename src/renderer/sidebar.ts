import type { DeskApi } from '../shared/contracts.js';
import type { FolderTree } from '../shared/folders.js';

export class Sidebar {
  private root: FolderTree | null = null;
  private readonly children = new Map<string, FolderTree>();
  private readonly expanded = new Set<string>();
  private selected = '';
  private standalone = '';
  private generation = 0;
  constructor(
    private readonly api: DeskApi,
    private readonly open: (id: string) => void,
    private readonly notice: (message: string) => void
  ) {}
  setFolder(tree: FolderTree | null) {
    this.generation++; this.root = tree; this.children.clear(); this.expanded.clear(); this.render();
  }
  setDocument(name: string, location: string) { this.standalone = name; this.selected = location; this.render(); }
  async refresh() {
    if (!this.root) return;
    const button = document.querySelector<HTMLButtonElement>('#refresh-folder')!;
    if (button.disabled) return;
    button.disabled = true;
    const generation = this.generation;
    try {
      const root = await this.api.listFolder(this.root.id);
      if (generation !== this.generation) return;
      if (!root.ok) { this.notice(root.message); return; }
      this.root = root.value;
      for (const id of this.expanded) {
        const child = await this.api.listFolder(id);
        if (generation !== this.generation) return;
        if (child.ok) this.children.set(id, child.value);
        else { this.children.delete(id); this.expanded.delete(id); }
      }
      this.notice(''); this.render();
    } finally { button.disabled = false; }
  }
  render() {
    const container = document.querySelector<HTMLElement>('#tree')!;
    document.querySelector('#folder-name')!.textContent = this.root?.name ?? (this.standalone ? 'Open file' : 'Files');
    document.querySelector<HTMLButtonElement>('#refresh-folder')!.hidden = !this.root;
    container.replaceChildren();
    if (!this.root) {
      if (this.standalone) {
        const button = document.createElement('button'); button.className = 'tree-file selected'; button.textContent = this.standalone;
        button.setAttribute('aria-current', 'page'); container.append(button);
      }
      return;
    }
    const append = (tree: FolderTree, parent: HTMLElement, prefix: string) => {
      if (!tree.entries.length) {
        const empty = document.createElement('p'); empty.className = 'empty-note'; empty.textContent = 'This folder is empty.'; parent.append(empty);
      }
      for (const entry of tree.entries) {
        const button = document.createElement('button');
        button.className = 'tree-entry'; button.dataset.entry = entry.id; button.dataset.kind = entry.kind; button.title = entry.name;
        const location = prefix + entry.name;
        button.textContent = `${entry.kind === 'directory' ? (this.expanded.has(entry.id) ? '▾ ' : '▸ ') : ''}${entry.name}${entry.linked ? ' ↗' : ''}`;
        if (entry.kind === 'unsupported') button.classList.add('unavailable');
        if (location === this.selected) button.setAttribute('aria-current', 'page');
        parent.append(button);
        if (entry.kind === 'directory') {
          button.setAttribute('aria-expanded', String(this.expanded.has(entry.id)));
          const nested = document.createElement('div'); nested.className = 'directory-children'; parent.append(nested);
          if (this.expanded.has(entry.id)) {
            const child = this.children.get(entry.id);
            if (child) append(child, nested, location + '/');
          }
          button.addEventListener('click', async () => {
            if (this.expanded.has(entry.id)) { this.expanded.delete(entry.id); this.render(); return; }
            button.disabled = true; button.textContent = `Loading ${entry.name}...`;
            const generation = this.generation;
            const result = await this.api.listFolder(entry.id);
            if (generation !== this.generation) return;
            if (result.ok) { this.children.set(entry.id, result.value); this.expanded.add(entry.id); this.notice(''); }
            else this.notice(result.message);
            this.render();
          });
        } else button.addEventListener('click', () => {
          if (entry.kind === 'unsupported') this.notice(entry.notice ?? 'Only Markdown files open here for now.');
          else this.open(entry.id);
        });
      }
    };
    append(this.root, container, '');
  }
}
