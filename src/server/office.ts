import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type OfficeConverterKind = 'ibisoffice' | 'libreoffice';
export interface OfficeConverter {
  kind: OfficeConverterKind;
  command: string;
}
export const OFFICE_CONVERTER_NAMES: Record<OfficeConverterKind, string> = {
  ibisoffice: 'ibisOffice',
  libreoffice: 'LibreOffice',
};
const SEARCH_NAMES = ['ibisOffice', 'ibisoffice', 'soffice', 'libreoffice'];
const TIMEOUT = 60_000;
const CACHE_LIMIT = 32;

export function converterKind(command: string): OfficeConverterKind {
  return /^(?:soffice|libreoffice)/i.test(path.basename(command))
    ? 'libreoffice'
    : 'ibisoffice';
}

async function executable(filename: string): Promise<boolean> {
  try {
    await access(filename, constants.X_OK);
    return (await stat(filename)).isFile();
  } catch {
    return false;
  }
}

async function which(
  name: string,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const extensions =
    process.platform === 'win32'
      ? (env.PATHEXT ?? '.EXE').split(';').filter(Boolean)
      : [''];
  for (const directory of (env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, name + extension);
      if (await executable(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Resolves an explicit converter, or prefers ibisOffice over LibreOffice on PATH. */
export async function findOfficeConverter(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OfficeConverter | null> {
  if (explicit) {
    const command = /[\\/]/.test(explicit)
      ? (await executable(path.resolve(explicit)))
        ? path.resolve(explicit)
        : undefined
      : await which(explicit, env);
    if (!command)
      throw new Error(
        `--office-converter: ${explicit} is not an executable file.`,
      );
    return { kind: converterKind(command), command };
  }
  const candidates: string[] = [];
  for (const name of SEARCH_NAMES) {
    const command = await which(name, env);
    if (command) candidates.push(command);
  }
  if (process.platform === 'darwin')
    candidates.push(
      '/Applications/ibisOffice.app/Contents/MacOS/ibisOffice',
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    );
  if (process.platform === 'win32' && env.ProgramFiles)
    candidates.push(
      path.join(env.ProgramFiles, 'LibreOffice', 'program', 'soffice.exe'),
    );
  for (const command of candidates)
    if (await executable(command))
      return { kind: converterKind(command), command };
  return null;
}

export class OfficeConversionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Converts Office documents to PDF in a private temporary directory.
 * Inputs are copies of validated file contents, so the converter never reads project paths.
 */
export class OfficeRenderer {
  private directory?: Promise<string>;
  // Keyed by content, so watch-mode edits convert again and reverted files reuse the cache.
  private readonly cache = new Map<string, Promise<string>>();
  private readonly children = new Set<ChildProcess>();
  private readonly queue: (() => void)[] = [];
  private readonly limit: number;
  private running = 0;
  private sequence = 0;
  private closed = false;

  constructor(readonly converter: OfficeConverter) {
    // LibreOffice instances sharing a profile cannot run concurrently.
    this.limit = converter.kind === 'libreoffice' ? 1 : 2;
  }

  get name(): string {
    return OFFICE_CONVERTER_NAMES[this.converter.kind];
  }

  pdf(bytes: Buffer, extension: string): Promise<string> {
    const key = createHash('sha256')
      .update(extension)
      .update('\0')
      .update(bytes)
      .digest('hex');
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const result = this.convert(key, bytes, extension);
    this.cache.set(key, result);
    result.catch(() => {
      if (this.cache.get(key) === result) this.cache.delete(key);
    });
    while (this.cache.size > CACHE_LIMIT) {
      const [oldest, pending] = this.cache.entries().next().value!;
      this.cache.delete(oldest);
      void pending.then(
        (filename) => rm(filename, { force: true }),
        () => {},
      );
    }
    return result;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const child of this.children) child.kill('SIGKILL');
    for (const next of this.queue.splice(0)) next();
    const directory = await this.directory?.catch(() => undefined);
    if (directory) await rm(directory, { recursive: true, force: true });
  }

  private root(): Promise<string> {
    this.directory ??= mkdtemp(path.join(tmpdir(), 'fzv-office-'));
    return this.directory;
  }

  private acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.running--;
  }

  private async convert(
    key: string,
    bytes: Buffer,
    extension: string,
  ): Promise<string> {
    await this.acquire();
    try {
      if (this.closed)
        throw new OfficeConversionError('The viewer is shutting down.', 503);
      const root = await this.root();
      const work = path.join(root, `work-${++this.sequence}`);
      await mkdir(work);
      try {
        const input = path.join(work, `document${extension}`);
        await writeFile(input, bytes, { flag: 'wx', mode: 0o600 });
        const stderr = await this.run(root, work, input);
        const target = path.join(root, `${key}.pdf`);
        try {
          await rename(path.join(work, 'document.pdf'), target);
        } catch {
          throw new OfficeConversionError(
            stderr || `${this.name} did not produce a PDF.`,
            422,
          );
        }
        return target;
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    } finally {
      this.release();
    }
  }

  /** Resolves with the last diagnostic line when the converter exits successfully. */
  private run(root: string, work: string, input: string): Promise<string> {
    const args =
      this.converter.kind === 'libreoffice'
        ? [
            '--headless',
            '--norestore',
            '--nolockcheck',
            `-env:UserInstallation=${pathToFileURL(path.join(root, 'libreoffice-profile')).href}`,
            '--convert-to',
            'pdf',
            '--outdir',
            work,
            input,
          ]
        : ['--export', 'pdf', '--out-dir', work, input];
    return new Promise((resolve, reject) => {
      const child = spawn(this.converter.command, args, {
        cwd: work,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });
      this.children.add(child);
      let stderr = '';
      let timedOut = false;
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < 8192) stderr += chunk;
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, TIMEOUT);
      const finish = () => {
        clearTimeout(timer);
        this.children.delete(child);
      };
      // Diagnostics name the temporary copy; show only its file name.
      const diagnostic = () =>
        stderr
          .replaceAll(work + path.sep, '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .at(-1)
          ?.slice(0, 500) ?? '';
      child.once('error', (error) => {
        finish();
        reject(
          new OfficeConversionError(
            `Could not start ${this.name}: ${error.message}`,
            503,
          ),
        );
      });
      child.once('close', (code, signal) => {
        finish();
        if (code === 0) resolve(diagnostic());
        else
          reject(
            new OfficeConversionError(
              timedOut
                ? `${this.name} did not finish within ${TIMEOUT / 1000} seconds.`
                : diagnostic() ||
                    `${this.name} exited with ${signal ?? `code ${code}`}.`,
              422,
            ),
          );
      });
    });
  }
}
