import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

export function sourceState(root) {
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return result.status === 0 ? result.stdout : null;
  };
  const unknownCommit = { commit: '', dirtyFiles: [] };
  const ownsGitHistory = git('rev-parse', '--show-toplevel')?.trim() === realpathSync.native(root);
  if (!ownsGitHistory) return unknownCommit;
  const commit = git('rev-parse', '--verify', 'HEAD')?.trim();
  if (!commit) return unknownCommit;
  const changed = git('diff', '--name-only', '-z', 'HEAD');
  const added = git('ls-files', '--others', '--exclude-standard', '-z');
  if (changed === null || added === null) throw new Error('Git could not list the changed files.');
  return { commit, dirtyFiles: [...new Set([...changed.split('\0'), ...added.split('\0')].filter(Boolean))].sort() };
}
