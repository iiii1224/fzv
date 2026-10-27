import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

// The vendored VS Code sources use TypeScript runtime syntax that Node cannot
// strip, so test the diff model through the same bundler as the application.
const output = await mkdtemp(path.join(tmpdir(), 'fzv-diff-test-'));
await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    outDir: output,
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: path.resolve('src/client/diff/model.ts'),
      formats: ['es'],
      fileName: 'model',
    },
  },
});
const {
  alignChange,
  buildRows,
  computeDiff,
  decorations,
  splitLines,
  unchangedRegions,
} = await import(pathToFileURL(path.join(output, 'model.js')).href);
test.after(() => rm(output, { recursive: true, force: true }));

const options = { ignoreTrimWhitespace: false, maxComputationTimeMs: 0 };

test('line changes carry VS Code character ranges', () => {
  const original = splitLines('const a = 1;\nconst b = 2;\n');
  const modified = splitLines('const a = 1;\nconst b = 3;\n');
  const { changes, quitEarly } = computeDiff(original, modified, options);
  assert.equal(quitEarly, false);
  assert.deepEqual(changes, [
    {
      original: [2, 3],
      modified: [2, 3],
      inner: [{ original: [2, 11, 2, 12], modified: [2, 11, 2, 12] }],
    },
  ]);
  const { original: left, modified: right } = decorations(
    changes,
    original,
    modified,
  );
  assert.deepEqual([...left.changed], [2]);
  assert.deepEqual(right.chars.get(2), [{ start: 10, end: 11 }]);
  assert.equal(right.whole.size, 0);
});

test('identical text has no changes and CRLF splits like LF', () => {
  const lines = splitLines('a\r\nb\rc\n');
  assert.deepEqual(lines, ['a', 'b', 'c', '']);
  assert.deepEqual(computeDiff(lines, [...lines], options).changes, []);
});

test('pure insertions highlight whole lines and pad the other side', () => {
  const original = splitLines('a\nd');
  const modified = splitLines('a\nb\nc\nd');
  const { changes } = computeDiff(original, modified, options);
  assert.deepEqual(changes[0].original, [2, 2]);
  assert.deepEqual(changes[0].modified, [2, 4]);
  const { modified: right } = decorations(changes, original, modified);
  assert.deepEqual([...right.whole], [2, 3]);
  assert.deepEqual(
    buildRows(changes, original, 'side-by-side').map((row) => [
      row.original,
      row.modified,
    ]),
    [
      [1, 1],
      [undefined, 2],
      [undefined, 3],
      [2, 4],
    ],
  );
});

test('inline rows place deleted lines before inserted lines', () => {
  const original = splitLines('a\nold\nz');
  const modified = splitLines('a\nnew 1\nnew 2\nz');
  const { changes } = computeDiff(original, modified, options);
  assert.deepEqual(
    buildRows(changes, original, 'inline').map((row) => [
      row.original,
      row.modified,
      row.change,
    ]),
    [
      [1, 1, undefined],
      [2, undefined, 0],
      [undefined, 2, 0],
      [undefined, 3, 0],
      [3, 4, undefined],
    ],
  );
});

test('side-by-side alignment keeps unchanged text inside a change level', () => {
  // A line is inserted before a modified line: VS Code aligns "x = 2" with "x = 3".
  const change = {
    original: [2, 3],
    modified: [2, 4],
    inner: [
      { original: [2, 1, 2, 1], modified: [2, 1, 3, 1] },
      { original: [2, 5, 2, 6], modified: [3, 5, 3, 6] },
    ],
  };
  assert.deepEqual(alignChange(change, ['a', 'x = 2', 'z']), [
    [2, 2, 2, 3],
    [2, 3, 3, 4],
  ]);
});

test('unchanged regions keep three context lines around changes', () => {
  const original = Array.from({ length: 30 }, (_, index) => `line ${index}`);
  const modified = [...original];
  modified[14] = 'changed';
  const { changes } = computeDiff(original, modified, options);
  const regions = unchangedRegions(changes, 30, 30);
  assert.deepEqual(regions, [
    { original: 1, modified: 1, length: 11 },
    { original: 19, modified: 19, length: 12 },
  ]);
  const rows = buildRows(changes, original, 'side-by-side', regions);
  assert.deepEqual(rows[0], { type: 'hidden', region: 0, count: 11 });
  assert.equal(rows.length, 1 + 3 + 1 + 3 + 1);
  assert.deepEqual(rows.at(-1), { type: 'hidden', region: 1, count: 12 });
});

test('a timeout still returns a complete coarse diff', () => {
  const original = Array.from({ length: 4000 }, (_, i) => `a${i % 97} ${i}`);
  const modified = Array.from({ length: 4000 }, (_, i) => `b${i % 89} ${i}`);
  const result = computeDiff(original, modified, {
    ignoreTrimWhitespace: false,
    maxComputationTimeMs: 1,
  });
  const rows = buildRows(result.changes, original, 'side-by-side');
  assert.equal(rows.filter((row) => row.original).length, 4000);
  assert.equal(rows.filter((row) => row.modified).length, 4000);
});
