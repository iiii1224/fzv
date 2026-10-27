import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createViewer, OFFICE_UNAVAILABLE } from '../dist/server/server.js';
import { converterKind, findOfficeConverter } from '../dist/server/office.js';
import { createFixture } from './fixtures.mjs';

let fixture, server, plainServer, origin, plainOrigin, log;
const listen = async (viewer) => {
  viewer.listen(0, '127.0.0.1');
  await once(viewer, 'listening');
  return `http://127.0.0.1:${viewer.address().port}`;
};
before(async () => {
  fixture = await createFixture();
  log = path.join(fixture.base, 'conversions.log');
  process.env.FZV_FAKE_OFFICE_LOG = log;
  ({ server } = await createViewer({
    root: fixture.root,
    officeConverter: fixture.officeConverter,
  }));
  ({ server: plainServer } = await createViewer({ root: fixture.root }));
  origin = await listen(server);
  plainOrigin = await listen(plainServer);
});
after(async () => {
  delete process.env.FZV_FAKE_OFFICE_LOG;
  for (const viewer of [server, plainServer]) {
    viewer?.closeAllConnections();
    await new Promise((resolve) => viewer?.close(resolve));
  }
  await fixture?.cleanup();
});
const converted = (file, base = origin, options) =>
  fetch(`${base}/office-pdf?${new URLSearchParams({ path: file })}`, options);
const conversions = async () =>
  (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean);

test('indexes Office documents and serves their original bytes for download', async () => {
  const index = await (await fetch(`${origin}/api/files`)).json();
  for (const file of [
    'docs/report.docx',
    'docs/budget.xlsx',
    'docs/slides.pptx',
  ])
    assert.equal(
      index.files.find((item) => item.path === file)?.kind,
      'office',
    );
  const original = await fetch(
    `${origin}/file?${new URLSearchParams({ path: 'docs/report.docx' })}`,
  );
  assert.equal(
    original.headers.get('content-type'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  assert.equal(await original.text(), 'Converted report');
});

test('converts a temporary copy to PDF once per content and supports ranges', async () => {
  await rm(log, { force: true });
  const [first, second] = await Promise.all([
    converted('docs/budget.xlsx'),
    converted('docs/budget.xlsx'),
  ]);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'application/pdf');
  const body = await first.text();
  assert.match(body, /^%PDF-/);
  assert.match(body, /\(Converted budget 1\)/);
  assert.equal(await second.text(), body);
  const ranged = await converted('docs/budget.xlsx', origin, {
    headers: { Range: 'bytes=0-4' },
  });
  assert.equal(ranged.status, 206);
  assert.equal(await ranged.text(), '%PDF-');
  const inputs = await conversions();
  assert.equal(inputs.length, 1);
  assert.equal(path.basename(inputs[0]), 'document.xlsx');
  assert.ok(!inputs[0].startsWith(fixture.root), inputs[0]);
});

test('converts again after the document changes', async () => {
  const target = path.join(fixture.root, 'docs', 'slides.pptx');
  await rm(log, { force: true });
  assert.match(
    await (await converted('docs/slides.pptx')).text(),
    /Converted slides/,
  );
  await writeFile(target, 'Updated slides');
  assert.match(
    await (await converted('docs/slides.pptx')).text(),
    /Updated slides/,
  );
  assert.equal((await conversions()).length, 2);
  await writeFile(target, 'Converted slides');
});

test('reports converter failures without exposing temporary paths', async () => {
  const response = await converted('docs/broken.docx');
  assert.equal(response.status, 422);
  assert.equal(
    await response.text(),
    'ibisOffice: document.docx: not a valid Office document\n',
  );
});

test('explains how to enable Office previews when no converter is configured', async () => {
  const response = await converted('docs/report.docx', plainOrigin);
  assert.equal(response.status, 503);
  assert.equal(await response.text(), `${OFFICE_UNAVAILABLE}\n`);
});

test('converts only validated Office files', async () => {
  for (const file of [
    'docs/example.pdf',
    'README.md',
    '../outside/secret.txt',
    '.private/secret.txt',
    'missing.docx',
  ])
    assert.equal((await converted(file)).status, 404, file);
});

test('finds ibisOffice before LibreOffice and validates explicit converters', async () => {
  const bin = path.join(fixture.base, 'search-bin');
  await mkdir(bin, { recursive: true });
  const install = async (name) => {
    const filename = path.join(bin, name);
    await writeFile(filename, '#!/bin/sh\n');
    await chmod(filename, 0o755);
    return filename;
  };
  const env = { PATH: bin };
  assert.equal(await findOfficeConverter(undefined, env), null);
  const soffice = await install('soffice');
  assert.deepEqual(await findOfficeConverter(undefined, env), {
    kind: 'libreoffice',
    command: soffice,
  });
  const ibis = await install('ibisOffice');
  assert.deepEqual(await findOfficeConverter(undefined, env), {
    kind: 'ibisoffice',
    command: ibis,
  });
  assert.deepEqual(await findOfficeConverter('soffice', env), {
    kind: 'libreoffice',
    command: soffice,
  });
  assert.deepEqual(await findOfficeConverter(ibis, {}), {
    kind: 'ibisoffice',
    command: ibis,
  });
  await writeFile(path.join(bin, 'not-executable'), '');
  await assert.rejects(
    findOfficeConverter(path.join(bin, 'not-executable'), env),
    /not an executable file/,
  );
  await assert.rejects(findOfficeConverter('missing', env), /missing/);
  assert.equal(converterKind('/opt/LibreOffice.AppImage'), 'libreoffice');
  assert.equal(
    converterKind('/opt/ibisOffice-0.8.4-Linux.AppImage'),
    'ibisoffice',
  );
});
