import test from 'node:test';
import assert from 'node:assert/strict';
import { FuzzyIndex } from '../src/client/search.ts';
import {
  readSession,
  writeSession,
  sessionKey,
} from '../src/client/session.ts';
const file = (path) => ({
  path,
  name: path.split('/').at(-1),
  kind: 'text',
  size: 1,
});
const paths = [
  'docs/main.md',
  'src/MapIndex.ts',
  'src/map.ts',
  'docs/日本語ノート.txt',
  'images/main.svg',
  'a/very-long-path/map.md',
];
const index = new FuzzyIndex(paths.map(file));
test('supports fuzzy subsequences, smart case, multiple terms, and unicode', () => {
  assert.ok(
    index.search('dmn').files.some((file) => file.path === 'docs/main.md'),
  );
  assert.deepEqual(
    index.search('MapI').files.map((file) => file.path),
    ['src/MapIndex.ts'],
  );
  assert.ok(index.search('map').files.length >= 2);
  assert.deepEqual(
    index.search('docs main').files.map((file) => file.path),
    ['docs/main.md'],
  );
  assert.deepEqual(
    index.search('日本').files.map((file) => file.path),
    ['docs/日本語ノート.txt'],
  );
  assert.equal(index.search('nonexistent').total, 0);
});
test('caps rendered results while keeping the full count and does not leak score buffers', () => {
  const large = new FuzzyIndex(
    Array.from({ length: 500 }, (_, i) => file(`docs/file-${i}.txt`)),
  );
  assert.equal(large.search('').files.length, 250);
  assert.equal(large.search('').total, 500);
  assert.equal(large.search('file').total, 500);
  const before = index.search('main');
  index.search('Map');
  index.search('nonexistent');
  assert.deepEqual(index.search('main'), before);
});
test('restores order, deduplicates tabs, separates projects, and tolerates malformed or denied storage', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  writeSession(storage, 'one', {
    version: 1,
    tabs: ['b.txt', 'a.txt'],
    active: 'a.txt',
  });
  assert.deepEqual(readSession(storage, 'one').tabs, ['b.txt', 'a.txt']);
  assert.equal(readSession(storage, 'two'), null);
  values.set(sessionKey('one'), '{bad');
  assert.equal(readSession(storage, 'one'), null);
  values.set(
    sessionKey('one'),
    JSON.stringify({ version: 1, tabs: ['a', 7, 'a', 'b'], active: 'b' }),
  );
  assert.deepEqual(readSession(storage, 'one').tabs, ['a', 'b']);
  const denied = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  assert.equal(readSession(denied, 'one'), null);
  assert.doesNotThrow(() =>
    writeSession(denied, 'one', { version: 1, tabs: [], active: null }),
  );
});
