import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupIds,
  splitLayout,
  removeFromLayout,
  measureLayout,
} from '../src/client/layout.ts';
import {
  readSession,
  writeSession,
  sessionKey,
} from '../src/client/session.ts';

test('nested splits preserve order and removing a group collapses only its branch', () => {
  let tree = { type: 'group', id: 'one' };
  tree = splitLayout(tree, 'one', 'two', 'right', 's1');
  tree = splitLayout(tree, 'two', 'three', 'down', 's2');
  tree = splitLayout(tree, 'one', 'four', 'left', 's3');
  assert.deepEqual(groupIds(tree), ['four', 'one', 'two', 'three']);
  const reduced = removeFromLayout(tree, 'two');
  assert.deepEqual(groupIds(reduced), ['four', 'one', 'three']);
  assert.equal(reduced.children[1].type, 'group');
  assert.deepEqual(groupIds(tree), ['four', 'one', 'two', 'three']);
  assert.equal(removeFromLayout({ type: 'group', id: 'one' }, 'one'), null);
});

test('layout respects nested minimum sizes and fits a small viewport without negative dimensions', () => {
  let tree = splitLayout(
    { type: 'group', id: 'one' },
    'one',
    'two',
    'right',
    's1',
  );
  tree = splitLayout(tree, 'two', 'three', 'down', 's2');
  tree.ratio = 0.01;
  const full = measureLayout(tree, { x: 0, y: 0, width: 1200, height: 800 });
  assert.equal(full.groups.get('one').width, 220);
  assert.equal(full.groups.get('two').x, 224);
  assert.equal(full.groups.get('two').height, 398);
  assert.equal(full.groups.get('three').y, 402);
  for (const width of [0, 2, 100, 320]) {
    const measured = measureLayout(tree, { x: 0, y: 0, width, height: 80 });
    for (const rect of measured.groups.values()) {
      assert.ok(rect.width >= 0 && rect.height >= 0);
      assert.ok(rect.x + rect.width <= width + 1e-8);
      assert.ok(rect.y + rect.height <= 80 + 1e-8);
    }
  }
});

const session = () => ({
  version: 2,
  layout: splitLayout(
    { type: 'group', id: 'one' },
    'one',
    'two',
    'right',
    's1',
  ),
  groups: [
    { id: 'one', tabs: [{ path: 'a.md', mode: 'source' }], active: 'a.md' },
    {
      id: 'two',
      tabs: [
        { path: 'a.md', mode: 'viewer' },
        { path: 'b.txt', mode: 'source' },
      ],
      active: 'b.txt',
    },
  ],
  activeGroup: 'two',
});

test('workspace sessions round-trip duplicate files across groups and migrate alongside legacy sessions', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const old = { version: 1, tabs: ['old.txt'], active: 'old.txt' };
  writeSession(storage, 'project', old);
  assert.deepEqual(readSession(storage, 'project'), old);
  const saved = session();
  saved.layout.ratio = 0.65;
  writeSession(storage, 'project', saved);
  assert.deepEqual(readSession(storage, 'project'), saved);
  assert.deepEqual(JSON.parse(values.get(sessionKey('project'))), old);
  assert.equal(readSession(storage, 'other'), null);
});

test('invalid workspace trees cannot create missing, repeated, unbounded or malformed groups', () => {
  const invalid = [
    (s) => {
      s.layout.children[0].id = 'missing';
    },
    (s) => {
      s.layout.children[1].id = 'one';
    },
    (s) => {
      s.layout.ratio = 0;
    },
    (s) => {
      s.layout.ratio = 2;
    },
    (s) => {
      s.layout.axis = 'z';
    },
    (s) => {
      s.layout.children.push({ type: 'group', id: 'three' });
    },
    (s) => {
      s.groups[1].id = 'one';
    },
    (s) => {
      s.groups[1].tabs = 'bad';
    },
    (s) => {
      s.groups.push({ id: 'unreferenced', tabs: [], active: null });
    },
    (s) => {
      s.groups = null;
    },
  ];
  for (const mutate of invalid) {
    const saved = session();
    mutate(saved);
    assert.equal(
      readSession(
        {
          getItem: (key) =>
            key.endsWith(':v2') ? JSON.stringify(saved) : null,
        },
        'project',
      ),
      null,
    );
  }
});
