import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createViewer } from '../dist/server/server.js';

let base, repository, root, server, origin;
const git = (...args) =>
  execFileSync('git', args, {
    cwd: repository,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'fzv',
      GIT_AUTHOR_EMAIL: 'fzv@example.invalid',
      GIT_COMMITTER_NAME: 'fzv',
      GIT_COMMITTER_EMAIL: 'fzv@example.invalid',
    },
  });
const write = async (name, content) => {
  await mkdir(path.dirname(path.join(repository, name)), { recursive: true });
  await writeFile(path.join(repository, name), content);
};

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'fzv-git-test-'));
  repository = path.join(base, 'repository');
  // The project root is a subdirectory, so git paths need the prefix removed.
  root = path.join(repository, 'project');
  await mkdir(root, { recursive: true });
  git('init', '-q', '-b', 'main');
  await write('project/modified.ts', 'const a = 1;\n');
  await write('project/staged.md', '# Title\n');
  await write('project/deleted.txt', 'gone\n');
  await write('project/old-name.txt', 'renamed\n');
  await write('project/.env', 'SECRET=1\n');
  await write('project/image.png', 'not really a png');
  await write('outside.txt', 'outside\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  await write('project/modified.ts', 'const a = 2;\n');
  await write('project/staged.md', '# New title\n');
  git('add', 'project/staged.md');
  await write('project/staged.md', '# Newer title\n');
  git('rm', '-q', 'project/deleted.txt');
  git('mv', 'project/old-name.txt', 'project/new-name.txt');
  await write('project/untracked.ts', 'export {};\n');
  await write('project/.env', 'SECRET=2\n');
  await write('project/node_modules/pkg/index.js', 'x\n');
  await write('project/image.png', 'changed');
  await write('outside.txt', 'changed\n');
  ({ server } = await createViewer({ root, git: 'git' }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => server?.close(resolve));
  await rm(base, { recursive: true, force: true });
});
const get = (path, options) => fetch(origin + path, options);
const blob = (path, revision) =>
  get('/api/git/file?' + new URLSearchParams({ path, revision }));

test('reports staged and working tree changes inside the visible project only', async () => {
  const project = await (await get('/api/project')).json();
  assert.equal(project.git, true);
  const status = await (await get('/api/git/status')).json();
  assert.equal(status.available, true);
  assert.equal(status.branch, 'main');
  const changes = status.changes
    .map(({ path, stage, status, originalPath, kind }) =>
      [stage, status, path, originalPath ?? '', kind].join(' '),
    )
    .sort();
  assert.deepEqual(
    changes,
    [
      'index R new-name.txt old-name.txt text',
      'index D deleted.txt  text',
      'index M staged.md  text',
      'worktree ? untracked.ts  text',
      'worktree M image.png  image',
      'worktree M modified.ts  text',
      'worktree M staged.md  text',
    ].sort(),
  );
});

test('reads HEAD and index contents for text files without exposing hidden paths', async () => {
  assert.equal(await (await blob('staged.md', 'HEAD')).text(), '# Title\n');
  assert.equal(
    await (await blob('staged.md', 'index')).text(),
    '# New title\n',
  );
  assert.equal(await (await blob('old-name.txt', 'HEAD')).text(), 'renamed\n');
  assert.equal(await (await blob('deleted.txt', 'HEAD')).text(), 'gone\n');
  assert.equal((await blob('deleted.txt', 'index')).status, 404);
  assert.equal((await blob('untracked.ts', 'index')).status, 404);
  for (const [path, revision] of [
    ['.env', 'HEAD'],
    ['../outside.txt', 'HEAD'],
    ['image.png', 'HEAD'],
    ['modified.ts', 'HEAD~1'],
    ['modified.ts', 'worktree'],
    ['', 'HEAD'],
  ])
    assert.equal(
      (await blob(path, revision)).status,
      404,
      `${path} ${revision}`,
    );
});

test('git requests never write repository state', async () => {
  const index = path.join(repository, '.git', 'index');
  const before = (await stat(index)).mtimeMs;
  await new Promise((resolve) => setTimeout(resolve, 20));
  await get('/api/git/status');
  await blob('modified.ts', 'index');
  assert.equal((await stat(index)).mtimeMs, before);
});

test('rejects cross-origin access to git data', async () => {
  const response = await get('/api/git/status', {
    headers: { Origin: 'https://example.com' },
  });
  assert.equal(response.status, 403);
});

test('is unavailable outside a repository or without a git executable', async () => {
  const plain = await mkdtemp(path.join(tmpdir(), 'fzv-no-git-'));
  try {
    for (const options of [{ git: 'git' }, {}]) {
      const { server } = await createViewer({ root: plain, ...options });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const url = `http://127.0.0.1:${server.address().port}`;
      const response = await fetch(`${url}/api/git/status`);
      if (options.git)
        assert.deepEqual(await response.json(), { available: false });
      else assert.equal(response.status, 404);
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await rm(plain, { recursive: true, force: true });
  }
});
