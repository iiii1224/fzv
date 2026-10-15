import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { MAX_FILE_SIZE } from '../shared.js';
import type {
  FileIndex,
  PreviewKind,
  ProjectDirectory,
  ProjectFile,
  ProjectInfo,
} from '../shared.js';

const TEXT = new Set([
  '.bib',
  '.bst',
  '.c',
  '.cc',
  '.cfg',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.go',
  '.h',
  '.hpp',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.lua',
  '.md',
  '.mjs',
  '.cjs',
  '.py',
  '.r',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.sty',
  '.tex',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);
const IMAGE = new Set([
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp',
  '.avif',
  '.bmp',
  '.ico',
]);
const ASSET = new Set(['.eot', '.otf', '.ttf', '.woff', '.woff2']);
const EXCLUDED = new Set(['node_modules', '__pycache__']);
const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.icc': 'application/octet-stream',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
};

export function previewKind(filename: string): PreviewKind | null {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (IMAGE.has(ext)) return 'image';
  if (
    TEXT.has(ext) ||
    ['Makefile', 'Dockerfile', 'LICENSE', 'LICENCE', 'NOTICE'].includes(
      path.basename(filename),
    )
  )
    return 'text';
  return null;
}

export function contentType(filename: string, asset = false): string {
  if (!asset && previewKind(filename) === 'text')
    return 'text/plain; charset=utf-8';
  return (
    MIME[path.extname(filename).toLowerCase()] ?? 'text/plain; charset=utf-8'
  );
}

export function isVisibleRelative(relative: string): boolean {
  if (
    !relative ||
    relative.includes('\0') ||
    relative.includes('\\') ||
    path.isAbsolute(relative) ||
    path.win32.isAbsolute(relative)
  )
    return false;
  return relative
    .split('/')
    .every(
      (part) => part.length > 0 && !part.startsWith('.') && !EXCLUDED.has(part),
    );
}

export class FileUnavailable extends Error {}
export interface OpenProjectFile {
  handle: FileHandle;
  size: number;
  filename: string;
  kind: PreviewKind | null;
}

export class Catalog {
  private constructor(
    readonly root: string,
    readonly project: ProjectInfo,
  ) {}

  static async create(root: string): Promise<Catalog> {
    const resolved = await realpath(path.resolve(root));
    if (!(await stat(resolved)).isDirectory())
      throw new Error('The project root must be a directory.');
    return new Catalog(resolved, {
      id: createHash('sha256').update(resolved).digest('hex').slice(0, 24),
      name: path.basename(resolved) || resolved,
      maxFileSize: MAX_FILE_SIZE,
    });
  }

  private contained(filename: string): boolean {
    const relative = path
      .relative(this.root, filename)
      .split(path.sep)
      .join('/');
    return isVisibleRelative(relative);
  }

  async openFile(relative: string, asset = false): Promise<OpenProjectFile> {
    if (!isVisibleRelative(relative)) throw new FileUnavailable();
    let handle: FileHandle | undefined;
    try {
      const filename = await realpath(path.join(this.root, relative));
      if (!this.contained(filename)) throw new FileUnavailable();
      const kind = previewKind(filename);
      // Alias and target must agree on kind, so a .txt alias cannot expose active HTML/SVG.
      if (
        (!kind &&
          !(asset && ASSET.has(path.extname(filename).toLowerCase()))) ||
        kind !== previewKind(relative)
      )
        throw new FileUnavailable();
      handle = await open(
        filename,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_FILE_SIZE)
        throw new FileUnavailable();
      const checkedPath = await realpath(filename);
      if (!this.contained(checkedPath)) throw new FileUnavailable();
      const checked = await stat(checkedPath);
      if (checked.dev !== info.dev || checked.ino !== info.ino)
        throw new FileUnavailable();
      return { handle, size: info.size, filename, kind };
    } catch {
      await handle?.close();
      throw new FileUnavailable();
    }
  }

  async list(): Promise<Pick<FileIndex, 'files' | 'directories'>> {
    const files: ProjectFile[] = [];
    const directories: ProjectDirectory[] = [];
    const pending = [''];
    while (pending.length) {
      const directory = pending.pop()!;
      let entries;
      try {
        const filename = await realpath(path.join(this.root, directory));
        if (directory && !this.contained(filename)) continue;
        entries = await readdir(filename, {
          withFileTypes: true,
        });
      } catch {
        continue;
      }
      if (directory)
        directories.push({
          path: directory,
          name: path.posix.basename(directory),
          kind: 'directory',
        });
      for (const entry of entries) {
        const relative = directory ? `${directory}/${entry.name}` : entry.name;
        if (!isVisibleRelative(relative)) continue;
        if (entry.isDirectory()) {
          pending.push(relative);
          continue;
        }
        if (
          (!entry.isFile() && !entry.isSymbolicLink()) ||
          !previewKind(relative)
        )
          continue;
        try {
          const file = await this.openFile(relative);
          files.push({
            path: relative,
            name: entry.name,
            kind: file.kind!,
            size: file.size,
          });
          await file.handle.close();
        } catch {
          /* Files can disappear or become unreadable during a scan. */
        }
      }
    }
    return {
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
      directories: directories.sort((a, b) => a.path.localeCompare(b.path)),
    };
  }

  async filesForPaths(paths: string[]): Promise<ProjectFile[]> {
    const unique = [...new Set(paths)];
    const files = await Promise.all(
      unique.map(async (relative) => {
        try {
          const file = await this.openFile(relative);
          try {
            return {
              path: relative,
              name: path.posix.basename(relative),
              kind: file.kind!,
              size: file.size,
            } satisfies ProjectFile;
          } finally {
            await file.handle.close();
          }
        } catch {
          return null;
        }
      }),
    );
    return files.filter((file): file is ProjectFile => file !== null);
  }
}
