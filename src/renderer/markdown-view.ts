declare const marked: typeof import('marked').marked;
export const escapeText = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
marked.use({ renderer: { html: token => escapeText(token.text) } });
export function anchorNames(): (heading: string) => string {
  const used = new Set<string>();
  return heading => {
    const base = 'md-' + heading.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/ +/g, '-');
    let name = base;
    for (let suffix = 1; used.has(name); suffix++) name = `${base}-${suffix}`;
    used.add(name);
    return name;
  };
}
export function preview(text: string, id: string): DocumentFragment {
  const anchor = anchorNames();
  const template = document.createElement('template');
  template.innerHTML = marked.parse(text.replace(/^\uFEFF/, ''), { async: false }) as string;
  const allowed = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'BR', 'HR', 'STRONG', 'EM', 'DEL', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'PRE', 'CODE', 'A', 'IMG', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'INPUT']);
  for (const node of template.content.querySelectorAll<HTMLElement>('*')) {
    if (!allowed.has(node.tagName)) { node.replaceWith(document.createTextNode(node.textContent ?? '')); continue; }
    const href = node.getAttribute('href');
    const src = node.getAttribute('src');
    const alt = node.getAttribute('alt') ?? '';
    const checked = node.hasAttribute('checked');
    const start = node.getAttribute('start');
    for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
    if (node.tagName === 'A' && href) { node.setAttribute('href', '#'); node.dataset.href = href; }
    if (node.tagName === 'IMG') {
      node.setAttribute('alt', alt);
      if (src && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src)) node.setAttribute('src', `desk://asset/${id}?path=${encodeURIComponent(src)}`);
      else { const blocked = document.createElement('span'); blocked.className = 'image-note'; blocked.textContent = `Image not loaded: ${alt || 'remote image'}`; node.replaceWith(blocked); }
    }
    if (node.tagName === 'INPUT') { node.setAttribute('type', 'checkbox'); node.setAttribute('disabled', ''); if (checked) node.setAttribute('checked', ''); }
    if (node.tagName === 'OL' && start && /^\d+$/.test(start)) node.setAttribute('start', start);
    if (/^H[1-6]$/.test(node.tagName)) node.id = anchor(node.textContent ?? '');
  }
  for (const table of template.content.querySelectorAll('table')) {
    const block = document.createElement('div');
    block.className = 'table-block';
    table.replaceWith(block);
    block.append(table);
  }
  return template.content;
}
