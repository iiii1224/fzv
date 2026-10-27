import { execFile } from 'node:child_process';
import { MAX_FILE_SIZE } from '../shared.js';
import type {
  GitChange,
  GitStage,
  GitStatus,
  GitStatusCode,
} from '../shared.js';
import { FileUnavailable, isVisibleRelative, previewKind } from './catalog.js';

const TIMEOUT = 10_000;
/** Blob sources a diff side can read: the HEAD commit or stage 0 of the index. */
export type GitRevision = 'HEAD' | 'index';

class GitCommandError extends Error {}

/** Read-only access to the repository containing the project root.
 * Every git path is mapped back to a project path and checked with the same
 * visibility rules as the file catalog; paths outside the root are dropped. */
export class GitRepository {
  constructor(
    private readonly command: string,
    private readonly root: string,
  ) {}

  private run(args: string[], maxBuffer = 32 * 1024 * 1024): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      execFile(
        this.command,
        // Never take index.lock, never start an fsmonitor hook, and never prompt.
        ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args],
        {
          cwd: this.root,
          encoding: 'buffer',
          maxBuffer,
          timeout: TIMEOUT,
          windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
        },
        (error, stdout) =>
          error ? reject(new GitCommandError(error.message)) : resolve(stdout),
      );
    });
  }

  /** The project root's path inside the work tree, with a trailing slash. */
  private async prefix(): Promise<string | null> {
    try {
      const [inside, prefix] = (
        await this.run(['rev-parse', '--is-inside-work-tree', '--show-prefix'])
      )
        .toString('utf8')
        .split('\n');
      return inside === 'true' ? (prefix ?? '') : null;
    } catch {
      return null;
    }
  }

  async status(): Promise<GitStatus> {
    const prefix = await this.prefix();
    if (prefix === null) return { available: false };
    const fields = (
      await this.run([
        'status',
        '-z',
        '--porcelain=v1',
        '--branch',
        '--untracked-files=all',
        '--',
        '.',
      ])
    )
      .toString('utf8')
      .split('\0');
    const project = (repositoryPath: string) => {
      if (!repositoryPath.startsWith(prefix)) return null;
      const relative = repositoryPath.slice(prefix.length);
      return isVisibleRelative(relative) ? relative : null;
    };
    let branch: string | null = null;
    const changes: GitChange[] = [];
    for (let index = 0; index < fields.length; index++) {
      const field = fields[index];
      if (field.startsWith('## ')) {
        // "## main...origin/main [ahead 1]", "## No commits yet on main", or "## HEAD (no branch)".
        const head = field.slice(3).replace(/^No commits yet on /, '');
        branch = head.startsWith('HEAD (no branch)')
          ? null
          : head.split('...')[0].split(' ')[0];
        continue;
      }
      if (field.length < 4) continue;
      const x = field[0];
      const y = field[1];
      const path = project(field.slice(3));
      // Renames and copies are followed by their source path.
      const source = x === 'R' || x === 'C' ? fields[++index] : undefined;
      if (!path) continue;
      const kind = previewKind(path);
      const add = (stage: GitStage, status: GitStatusCode, from?: string) => {
        const originalPath = from === undefined ? null : project(from);
        changes.push({
          path,
          ...(originalPath ? { originalPath } : {}),
          stage,
          status,
          kind,
        });
      };
      if (x === '?' && y === '?') add('worktree', '?');
      else if (
        x === 'U' ||
        y === 'U' ||
        (x === 'A' && y === 'A') ||
        (x === 'D' && y === 'D')
      )
        add('worktree', 'U');
      else {
        if (x !== ' ') add('index', x as GitStatusCode, source);
        if (y !== ' ') add('worktree', y as GitStatusCode);
      }
    }
    return { available: true, branch, changes };
  }

  /** Reads a project file as stored in HEAD or the index, without filters. */
  async read(relative: string, revision: GitRevision): Promise<Buffer> {
    const kind = previewKind(relative);
    if (!isVisibleRelative(relative) || (kind !== 'text' && kind !== 'html'))
      throw new FileUnavailable();
    const prefix = await this.prefix();
    if (prefix === null) throw new FileUnavailable();
    const object = `${revision === 'HEAD' ? 'HEAD' : ':0'}:${prefix}${relative}`;
    try {
      const size = Number(
        (await this.run(['cat-file', '-s', object])).toString('utf8').trim(),
      );
      if (!Number.isSafeInteger(size) || size > MAX_FILE_SIZE)
        throw new FileUnavailable();
      return await this.run(['cat-file', 'blob', object], MAX_FILE_SIZE + 1);
    } catch {
      throw new FileUnavailable();
    }
  }
}
