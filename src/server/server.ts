import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Catalog, contentType, FileUnavailable } from './catalog.js';
import type { OpenProjectFile } from './catalog.js';

const UI_ROOT = fileURLToPath(new URL('../client/', import.meta.url));
const UI_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
export const PREVIEW_CSP =
  "sandbox allow-scripts; default-src 'none'; img-src http: https: data: blob:; style-src http: https: data: 'unsafe-inline'; font-src http: https: data:; media-src http: https: data: blob:; script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self'; frame-ancestors 'self'";

function reply(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  type: string,
  body: string | Buffer,
): void {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': bytes.length,
  });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

export type ByteRange = { start: number; end: number } | 'invalid' | null;
export function parseRange(
  header: string | undefined,
  size: number,
): ByteRange {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return 'invalid';
  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;
  if (
    (first !== undefined && !Number.isSafeInteger(first)) ||
    (last !== undefined && !Number.isSafeInteger(last))
  )
    return 'invalid';
  if (first === undefined) {
    if (!last) return 'invalid';
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (first >= size || (last !== undefined && last < first)) return 'invalid';
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}

export function renderHtml(source: string, relative: string): string {
  const parent = path.posix.dirname(relative);
  const base =
    '/asset/' +
    (parent === '.'
      ? ''
      : parent.split('/').map(encodeURIComponent).join('/') + '/');
  // The first base element wins. Insert ours before any user content, without parsing/replacing HTML with regex.
  return `<!doctype html><base href="${base}">` + source.replace(/^\uFEFF/, '');
}

async function sendProjectFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: OpenProjectFile,
  relative: string,
  asset: boolean,
): Promise<void> {
  try {
    if (file.kind === 'html' && asset) {
      res.setHeader('Content-Security-Policy', PREVIEW_CSP);
      const source = await file.handle.readFile({ encoding: 'utf8' });
      reply(
        req,
        res,
        200,
        'text/html; charset=utf-8',
        renderHtml(source, relative),
      );
      return;
    }
    // The response header also protects SVG or HTML opened directly in a browser tab.
    res.setHeader('Content-Security-Policy', PREVIEW_CSP);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', 'inline');
    const range = parseRange(req.headers.range, file.size);
    if (range === 'invalid') {
      res.setHeader('Content-Range', `bytes */${file.size}`);
      reply(
        req,
        res,
        416,
        'text/plain; charset=utf-8',
        'Range not satisfiable\n',
      );
      return;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? file.size - 1;
    const size = range ? end - start + 1 : file.size;
    res.setHeader(
      'Content-Type',
      file.kind === 'html'
        ? 'text/plain; charset=utf-8'
        : contentType(file.filename, asset),
    );
    res.setHeader('Content-Length', size);
    if (range)
      res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
    res.writeHead(range ? 206 : 200);
    if (req.method === 'HEAD' || size === 0) {
      res.end();
      return;
    }
    await pipeline(
      file.handle.createReadStream({ start, end, autoClose: false }),
      res,
    );
  } finally {
    await file.handle.close();
  }
}

function allowedHosts(host: string): Set<string> {
  const values = new Set(['localhost', '127.0.0.1', '[::1]', host]);
  if (host === '0.0.0.0' || host === '::') {
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? [])
        values.add(
          entry.family === 'IPv6' ? `[${entry.address}]` : entry.address,
        );
    }
  }
  return values;
}

export interface ViewerOptions {
  root: string;
  host?: string;
  uiRoot?: string;
}
export async function createViewer(options: ViewerOptions) {
  const catalog = await Catalog.create(options.root);
  const hosts = allowedHosts(options.host ?? '127.0.0.1');
  const uiRoot = await realpath(options.uiRoot ?? UI_ROOT);
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', UI_CSP);
    try {
      if (
        !req.url?.startsWith('/') ||
        req.url.startsWith('//') ||
        !req.headers.host
      ) {
        reply(req, res, 400, 'text/plain', 'Bad request\n');
        return;
      }
      const origin = new URL(`http://${req.headers.host}`);
      if (!hosts.has(origin.hostname)) {
        reply(req, res, 403, 'text/plain', 'Host not allowed\n');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        reply(req, res, 405, 'text/plain', 'Method not allowed\n');
        return;
      }
      const url = new URL(req.url, origin);
      if (url.pathname === '/api/project' || url.pathname === '/api/files') {
        if (req.headers.origin && req.headers.origin !== origin.origin) {
          reply(req, res, 403, 'text/plain', 'Origin not allowed\n');
          return;
        }
        const body =
          url.pathname === '/api/project'
            ? catalog.project
            : { project: catalog.project, ...(await catalog.list()) };
        reply(
          req,
          res,
          200,
          'application/json; charset=utf-8',
          JSON.stringify(body),
        );
        return;
      }
      if (url.pathname === '/preview-html') {
        const relative = url.searchParams.get('path') ?? '';
        const file = await catalog.openFile(relative);
        try {
          if (file.kind !== 'html') throw new FileUnavailable();
          const source = await file.handle.readFile({ encoding: 'utf8' });
          res.setHeader('Content-Security-Policy', PREVIEW_CSP);
          reply(
            req,
            res,
            200,
            'text/html; charset=utf-8',
            renderHtml(source, relative),
          );
        } finally {
          await file.handle.close();
        }
        return;
      }
      if (url.pathname === '/file' || url.pathname.startsWith('/asset/')) {
        const asset = url.pathname.startsWith('/asset/');
        const relative = asset
          ? decodeURIComponent(url.pathname.slice('/asset/'.length))
          : (url.searchParams.get('path') ?? '');
        const file = await catalog.openFile(relative, asset);
        await sendProjectFile(req, res, file, relative, asset);
        return;
      }
      const relative =
        url.pathname === '/'
          ? 'index.html'
          : decodeURIComponent(url.pathname).slice(1);
      if (
        !relative ||
        relative.split('/').some((part) => part.startsWith('.')) ||
        relative.includes('\\') ||
        relative.includes('\0')
      )
        throw new FileUnavailable();
      const filename = await realpath(path.join(uiRoot, relative));
      const inside = path.relative(uiRoot, filename);
      if (
        inside.startsWith('..') ||
        path.isAbsolute(inside) ||
        !(await stat(filename)).isFile()
      )
        throw new FileUnavailable();
      const body = await readFile(filename);
      reply(req, res, 200, contentType(filename, true), body);
    } catch (error) {
      if (res.headersSent || res.destroyed) {
        res.destroy();
        return;
      }
      const status =
        error instanceof URIError
          ? 400
          : error instanceof FileUnavailable ||
              (error instanceof Error &&
                'code' in error &&
                ['ENOENT', 'ENOTDIR', 'EACCES'].includes(String(error.code)))
            ? 404
            : 500;
      reply(
        req,
        res,
        status,
        'text/plain; charset=utf-8',
        status === 404
          ? 'Not found\n'
          : status === 400
            ? 'Bad request\n'
            : 'Could not load this resource\n',
      );
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return { server, catalog };
}
