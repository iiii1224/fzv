import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import path from 'node:path';
import { createFixture } from './fixtures.mjs';
import { Catalog } from '../dist/server/catalog.js';
import { projectPort } from '../dist/server/network.js';

const cli = path.resolve('dist/server/cli.js');

function start(args, cwd) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('CLI startup timed out: ' + stderr)),
      10000,
    );
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(stdout);
      if (match) {
        clearTimeout(timer);
        resolve({ port: Number(match[1]), stderr });
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
  return { child, ready };
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await once(child, 'exit');
}

async function occupy(port) {
  const server = createServer();
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

test('default port follows the project path', async () => {
  const fixture = await createFixture();
  const { child, ready } = start([], fixture.root);
  try {
    const { project } = await Catalog.create(fixture.root);
    const result = await ready;
    assert.equal(result.port, projectPort(project.id), result.stderr);
    assert.equal((await fetch(`http://127.0.0.1:${result.port}/`)).status, 200);
  } finally {
    await stop(child);
    await fixture.cleanup();
  }
});

test('busy project port falls back to a free port', async () => {
  const fixture = await createFixture();
  const { project } = await Catalog.create(fixture.root);
  const preferred = projectPort(project.id);
  const blocker = await occupy(preferred);
  const { child, ready } = start(['--root', fixture.root], fixture.root);
  try {
    const result = await ready;
    assert.ok(result.port > 0 && result.port !== preferred);
    assert.match(
      result.stderr,
      new RegExp(`Port ${preferred} is in use; using a free port`),
    );
    assert.equal((await fetch(`http://127.0.0.1:${result.port}/`)).status, 200);
  } finally {
    await stop(child);
    blocker.close();
    await fixture.cleanup();
  }
});

test('explicit ports do not fall back', async () => {
  const fixture = await createFixture();
  const blocker = await occupy(0);
  const busy = blocker.address().port;
  try {
    const { ready } = start(['--port', String(busy)], fixture.root);
    const result = await ready;
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      new RegExp(`Port ${busy} is in use\\. Choose another with --port\\.`),
    );
    const zero = start(['--port', '0'], fixture.root);
    try {
      const started = await zero.ready;
      assert.ok(started.port > 0);
      assert.doesNotMatch(started.stderr, /using a free port/);
    } finally {
      await stop(zero.child);
    }
  } finally {
    blocker.close();
    await fixture.cleanup();
  }
});
