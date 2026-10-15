import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
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
      assert.ok(
        !packed.files.some((file) =>
          /^(src|test|node_modules)\//.test(file.path),
        ),
      );
      const archive = path.join(directory, packed.filename);
      const cache = path.join(directory, 'cache');
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
      const packageRoot = path.join(install, 'node_modules', 'fzv');
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
      child = spawn(process.execPath, [cli, '--port', '0'], {
        cwd: fixture.root,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
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
      const index = await (await fetch(new URL('/api/files', origin))).json();
      assert.equal(index.project.name, 'project');
      assert.ok(index.files.some((file) => file.path === 'README.md'));
      assert.ok(log.includes(fixture.root));
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
