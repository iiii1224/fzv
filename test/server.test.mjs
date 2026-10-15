import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { createViewer, parseRange } from '../dist/server/server.js';
import { Catalog } from '../dist/server/catalog.js';
import { createFixture } from './fixtures.mjs';

let fixture, server, origin;
before(async () => {
  fixture = await createFixture();
  ({ server } = await createViewer({ root: fixture.root }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => server?.close(resolve));
  await fixture?.cleanup();
});
const get = (path, options) => fetch(origin + path, options);
const file = (path, options) =>
  get('/file?' + new URLSearchParams({ path }), options);

test('indexes supported files and excludes secrets, dependencies, oversized files, and escaping aliases', async () => {
  const response = await get('/api/files');
  assert.equal(response.status, 200);
  const index = await response.json();
  const paths = index.files.map((item) => item.path);
  for (const path of [
    'README.md',
    'docs/page.html',
    'docs/image.svg',
    'docs/example.pdf',
    'docs/hello world 日本語.txt',
  ])
    assert.ok(paths.includes(path), path);
  for (const path of [
    '.env',
    '.private/secret.txt',
    'node_modules/dependency/index.js',
    'too-large.txt',
    'escape.txt',
    'escape-dir/secret.txt',
    'hidden-alias.txt',
    'disguised.txt',
  ])
    assert.ok(!paths.includes(path), path);
  assert.ok(index.project.id);
  assert.equal(index.project.maxFileSize, 20 * 1024 * 1024);
});
test('uses stable project identifiers and separates different roots', async () => {
  const a = await Catalog.create(fixture.root);
  const b = await Catalog.create(fixture.root + '/docs');
  const c = await Catalog.create(fixture.root + '/../project');
  assert.equal(a.project.id, c.project.id);
  assert.notEqual(a.project.id, b.project.id);
});
test('serves filenames containing spaces, unicode, and markup as plain text', async () => {
  const response = await file('docs/hello world 日本語.txt');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/plain/);
  assert.match(await response.text(), /<unsafe>/);
  assert.equal(await (await file('x <script>.txt')).text(), 'A safe filename.');
});
test('validates every direct file and asset request, including encoded traversal', async () => {
  for (const path of [
    '../outside/secret.txt',
    '/etc/passwd',
    'docs/../../outside/secret.txt',
    '.env',
    '.private/secret.txt',
    'node_modules/dependency/index.js',
    'too-large.txt',
    'docs\\..\\README.md',
    'C:\\Windows\\win.ini',
    'docs/./page.html',
    'docs//page.html',
    '\0bad.txt',
  ]) {
    assert.equal((await file(path)).status, 404, path);
    assert.equal(
      (await get('/asset/' + encodeURIComponent(path))).status,
      404,
      path,
    );
  }
  for (const raw of [
    '/asset/%2e%2e%2foutside%2fsecret.txt',
    '/asset/%252e%252e%252foutside%252fsecret.txt',
    '/asset/%2Eenv',
  ])
    assert.equal((await get(raw)).status, 404, raw);
});
test('rejects escaping or hidden symlinks but supports an internal file alias', async (t) => {
  if (process.platform === 'win32')
    return t.skip('Symlink creation requires extra privileges on Windows.');
  for (const path of [
    'escape.txt',
    'escape-dir/secret.txt',
    'hidden-alias.txt',
    'disguised.txt',
  ]) {
    assert.equal((await file(path)).status, 404, path);
    assert.equal((await get('/asset/' + path)).status, 404, path);
  }
  assert.match(await (await file('readme-alias.md')).text(), /Example project/);
});
test('preserves HTML relative resources with a first base and response sandbox', async () => {
  const response = await get(
    '/preview-html?' + new URLSearchParams({ path: 'docs/page.html' }),
  );
  const html = await response.text();
  assert.match(html, /^<!doctype html><base href="\/asset\/docs\/">/);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /sandbox allow-scripts;/);
  assert.match(csp, /connect-src 'none'/);
  assert.ok(!csp.includes('allow-same-origin'));
  assert.equal((await get('/asset/docs/image.svg')).status, 200);
  assert.match(
    (await get('/asset/docs/style.css')).headers.get('content-type'),
    /^text\/css/,
  );
  assert.match(
    (await get('/asset/docs/page.html')).headers.get('content-security-policy'),
    /sandbox/,
  );
  assert.match(
    (await file('docs/page.html')).headers.get('content-type'),
    /^text\/plain/,
  );
  assert.equal((await get('/preview-html?path=README.md')).status, 404);
});
test('supports bounded, open-ended, and suffix PDF ranges with HEAD parity', async () => {
  const full = await (await file('docs/example.pdf')).arrayBuffer();
  for (const [header, start, end] of [
    ['bytes=0-7', 0, 7],
    ['bytes=10-', 10, full.byteLength - 1],
    ['bytes=-8', full.byteLength - 8, full.byteLength - 1],
    ['bytes=0-999999', 0, full.byteLength - 1],
  ]) {
    const response = await file('docs/example.pdf', {
      headers: { Range: header },
    });
    assert.equal(response.status, 206);
    assert.equal(
      response.headers.get('content-range'),
      `bytes ${start}-${end}/${full.byteLength}`,
    );
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      Buffer.from(full).subarray(start, end + 1),
    );
  }
  const head = await file('docs/example.pdf', {
    method: 'HEAD',
    headers: { Range: 'bytes=0-7' },
  });
  assert.equal(head.status, 206);
  assert.equal(head.headers.get('content-length'), '8');
  assert.equal(await head.text(), '');
});
test('rejects malformed or unsatisfiable ranges and handles empty files', async () => {
  for (const range of [
    'bytes=9999999-',
    'bytes=9-1',
    'bytes=-0',
    'bytes=',
    'bytes=1-2,4-5',
    'bytes=999999999999999999999999-',
  ])
    assert.equal(
      (await file('docs/example.pdf', { headers: { range } })).status,
      416,
      range,
    );
  assert.equal(parseRange('bytes=0-', 0), 'invalid');
  assert.equal(parseRange(undefined, 0), null);
  const empty = await file('empty.txt');
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get('content-length'), '0');
  assert.equal(await empty.text(), '');
  assert.equal(
    (await file('empty.txt', { headers: { range: 'bytes=0-' } })).status,
    416,
  );
});
test('rejects a rebinding Host, cross-origin API access, and writes', async () => {
  const response = await new Promise((resolve, reject) => {
    const req = request(
      origin + '/api/files',
      { headers: { Host: 'attacker.invalid' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(response, 403);
  assert.equal(
    (
      await get('/api/files', {
        headers: { Origin: 'https://attacker.invalid' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await get('/api/files', { headers: { Origin: 'null' } })).status,
    403,
  );
  const post = await get('/file?path=README.md', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});
test('serves the built UI and blocks unlisted static paths', async () => {
  const response = await get('/');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /fzv/);
  assert.match(
    response.headers.get('content-security-policy'),
    /frame-ancestors 'none'/,
  );
  for (const path of [
    '/package.json',
    '/src/server/cli.ts',
    '/nonexistent',
    '/assets/%00bad',
    '/assets/%ZZ',
  ])
    assert.ok([400, 404].includes((await get(path)).status), path);
});
