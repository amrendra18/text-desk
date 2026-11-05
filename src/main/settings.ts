import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DeskError, type Settings } from '../shared/contracts.js';

const themes = ['ember', 'graphite', 'midnight', 'plum', 'paper', 'system'];
function checkedSettings(value: unknown): Settings {
  const settings = value as Settings | null;
  if (!settings || typeof settings.autosave !== 'boolean' || !themes.includes(settings.theme)) {
    throw new DeskError('settings', 'Choose a listed theme and a valid autosave setting.');
  }
  return { autosave: settings.autosave, theme: settings.theme };
}
export class Preferences {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly folder: string) {}
  async read(): Promise<Settings> {
    try {
      const stored = JSON.parse(await readFile(path.join(this.folder, 'settings.json'), 'utf8'));
      if (stored.version !== 1) throw new Error('version');
      return checkedSettings(stored);
    } catch (error) {
      return { autosave: false, theme: 'ember', ...((error as NodeJS.ErrnoException).code === 'ENOENT' ? {} : { notice: 'Settings could not be read. Default settings are in use.' }) };
    }
  }
  write(value: unknown): Promise<Settings> {
    const settings = checkedSettings(value);
    const result = this.queue.then(async () => {
      await mkdir(this.folder, { recursive: true });
      const temporary = path.join(this.folder, `.settings-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, ...settings }), { flag: 'wx', mode: 0o600 });
        await rename(temporary, path.join(this.folder, 'settings.json'));
      } finally { await rm(temporary, { force: true }); }
      return settings;
    });
    this.queue = result.catch(() => {});
    return result;
  }
}
