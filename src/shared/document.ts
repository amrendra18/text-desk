import { DeskError } from './contracts.js';

export interface SaveResult {
  text: string;
  revision: string;
}

export function prepareSaveText(original: string, draft: string): string {
  const normalize = (text: string) => text.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n');
  if (draft.includes('\0') || new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(draft)) !== draft) {
    throw new DeskError('encoding', 'This draft contains unsupported text. Your draft has been kept.');
  }
  const normalized = normalize(draft);
  if (normalized === normalize(original)) return original;
  const endings = new Set(original.match(/\r\n|\r|\n/g) ?? []);
  if (endings.size > 1) {
    throw new DeskError('mixed-endings', 'This file mixes line endings. Saving edits would change them. Your draft has been kept.');
  }
  const ending = endings.values().next().value ?? '\n';
  return (original.startsWith('\uFEFF') ? '\uFEFF' : '') + normalized.replace(/\n/g, ending);
}
