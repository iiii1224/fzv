import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { createFixture } from './fixtures.mjs';
import { VERSION } from '../dist/shared.js';

const exec = promisify(execFile);
const npmCli = process.env.npm_execpath;

test(
  'packed package runs through npx and serves assets from an unrelated working directory',
  { timeout: 45000 },
  async () => {
    assert.ok(npmCli, 'Run package verification with npm test.');
    const directory = await mkdtemp(path.join(tmpdir(), 'fzv-package-'));
    const cache = path.join(directory, 'cache');
    const fixture = await createFixture();
    let child;
    try {
      const { stdout } = await exec(
        process.execPath,
        [
          npmCli,
          'pack',
          '--ignore-scripts',
          '--json',
          '--pack-destination',
          directory,
          '--cache',
          cache,
        ],
        { cwd: process.cwd() },
      );
      const [packed] = JSON.parse(stdout);
      assert.ok(
        packed.files.some((file) => file.path === 'dist/client/index.html'),
      );
      assert.ok(
        packed.files.some((file) => file.path === 'THIRD_PARTY_NOTICES.md'),
      );
      for (const license of [
        'codicons-CC-BY-4.0.txt',
        'codicons-MIT.txt',
        'marked.txt',
        'dompurify-APACHE-2.0.txt',
        'vscode-MIT.txt',
        'shiki/shiki-LICENSE',
        'pdfjs/Apache-2.0.txt',
        'pdfjs/cmaps-LICENSE',
        'pdfjs/LICENSE_FOXIT',
        'pdfjs/LICENSE_LIBERATION',
        'pdfjs/LICENSE_OPENJPEG',
        'pdfjs/LICENSE_JBIG2',
        'pdfjs/LICENSE_QCMS',
      ])
        assert.ok(
          packed.files.some((file) => file.path === `licenses/${license}`),
        );
      assert.ok(
        !packed.files.some((file) =>
          /^(src|test|node_modules)\//.test(file.path),
        ),
      );
      const archive = path.join(directory, packed.filename);
      const npxCli = path.join(path.dirname(npmCli), 'npx-cli.js');
      const version = await exec(
        process.execPath,
        [
          npxCli,
          '--offline',
          '--yes',
          '--cache',
          cache,
          '--package',
          archive,
          'fzv',
          '--version',
        ],
        { cwd: fixture.root },
      );
      assert.equal(version.stdout.trim(), VERSION);
      const install = path.join(directory, 'installed');
      await mkdir(install);
      await exec(process.execPath, [
        npmCli,
        'install',
        '--prefix',
        install,
        '--cache',
        cache,
        '--offline',
        '--ignore-scripts',
        '--omit=dev',
        '--no-audit',
        '--no-fund',
        archive,
      ]);
      const packageRoot = path.join(install, 'node_modules', '@aaa_iii', 'fzv');
      const metadata = JSON.parse(
        await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
      );
      assert.equal(metadata.version, VERSION);
      assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0);
      const cli = path.join(packageRoot, metadata.bin.fzv);
      const invalid = await exec(process.execPath, [cli, '--port', '-1']).catch(
        (error) => error,
      );
      assert.equal(invalid.code, 1);
      assert.match(invalid.stderr, /--port/);
      child = spawn(
        process.execPath,
        [cli, '--host', '0.0.0.0', '--port', '0'],
        {
          cwd: fixture.root,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let log = '';
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      const origin = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Packed CLI startup timed out: ' + stderr));
        }, 10000);
        child.stdout.on('data', (chunk) => {
          log += chunk;
          const match = /http:\/\/127\.0\.0\.1:\d+\//.exec(log);
          if (match) {
            clearTimeout(timer);
            resolve(match[0]);
          }
        });
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`Packed CLI exited: ${code}; ${stderr}`));
        });
      });
      const response = await fetch(origin);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /fzv/);
      const js = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
      assert.ok(js);
      assert.equal((await fetch(new URL(js, origin))).status, 200);
      const css = /<link[^>]+href="([^"]+\.css)"/.exec(html)?.[1];
      assert.ok(css);
      const stylesheet = await (await fetch(new URL(css, origin))).text();
      const font = /url\(["']?([^\s"')]+\.ttf(?:\?[^\s"')]*)?)["']?\)/.exec(
        stylesheet,
      )?.[1];
      assert.ok(
        font,
        'The packed stylesheet references a local Codicons font.',
      );
      const fontResponse = await fetch(new URL(font, new URL(css, origin)));
      assert.equal(fontResponse.status, 200);
      assert.match(fontResponse.headers.get('content-type'), /^font\/ttf/);
      const highlightAssets = packed.files.filter((file) =>
        /^dist\/client\/assets\/(highlight|typescript|light-plus)-.*\.js$/.test(
          file.path,
        ),
      );
      assert.ok(
        highlightAssets.some((file) => file.path.includes('/highlight-')),
      );
      assert.ok(
        highlightAssets.some((file) => file.path.includes('/typescript-')),
      );
      for (const asset of highlightAssets)
        assert.equal(
          (
            await fetch(
              new URL(
                `/_fzv/${asset.path.replace('dist/client/', '')}`,
                origin,
              ),
            )
          ).status,
          200,
        );
      for (const [asset, type] of [
        ['build/pdf.worker.mjs', /^text\/javascript/],
        ['cmaps/Adobe-Japan1-UCS2.bcmap', /^application\/octet-stream/],
        ['standard_fonts/LiberationSans-Regular.ttf', /^font\/ttf/],
        ['wasm/openjpeg.wasm', /^application\/wasm/],
        ['wasm/jbig2.wasm', /^application\/wasm/],
        ['wasm/qcms_bg.wasm', /^application\/wasm/],
        ['iccs/CGATS001Compat-v2-micro.icc', /^application\/octet-stream/],
      ]) {
        const resource = `pdfjs/${asset}`;
        assert.ok(
          packed.files.some((file) => file.path === `dist/client/${resource}`),
        );
        const response = await fetch(new URL(`/_fzv/${resource}`, origin));
        assert.equal(response.status, 200, resource);
        assert.match(response.headers.get('content-type'), type);
      }
      const index = await (await fetch(new URL('/api/files', origin))).json();
      assert.equal(index.project.name, 'project');
      assert.ok(index.files.some((file) => file.path === 'README.md'));
      assert.ok(log.includes(fixture.root));
      const port = new URL(origin).port;
      for (const entries of Object.values(networkInterfaces()))
        for (const entry of entries ?? [])
          if (entry.family === 'IPv4')
            assert.ok(log.includes(`http://${entry.address}:${port}/`));
    } finally {
      if (child && child.exitCode === null) {
        child.kill('SIGTERM');
        await once(child, 'exit');
      }
      await fixture.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
