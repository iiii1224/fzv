import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error This intentionally tests built distribution files.
import { createViewer } from '../../dist/server/server.js';

let root: string;
let server: import('node:http').Server;
let origin: string;
const git = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'fzv',
      GIT_AUTHOR_EMAIL: 'fzv@example.invalid',
      GIT_COMMITTER_NAME: 'fzv',
      GIT_COMMITTER_EMAIL: 'fzv@example.invalid',
    },
  });
const lines = (count: number, label: string) =>
  Array.from({ length: count }, (_, index) => `${label} ${index + 1}`).join(
    '\n',
  );

test.beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'fzv-sidebar-browser-'));
  git('init', '-q', '-b', 'main');
  for (const directory of ['src/lib', '.hidden', 'node_modules/pkg'])
    await mkdir(path.join(root, directory), { recursive: true });
  await writeFile(path.join(root, 'src/lib/util.ts'), 'export const a = 1;\n');
  await writeFile(path.join(root, 'src/main.ts'), 'export {};\n');
  await writeFile(path.join(root, '.hidden/secret.ts'), 'secret\n');
  await writeFile(path.join(root, 'node_modules/pkg/index.js'), 'x\n');
  await writeFile(
    path.join(root, 'app.ts'),
    `${lines(40, '// top')}\nconst value = 1;\n`,
  );
  await writeFile(path.join(root, 'notes.md'), '# Notes\n\nFirst draft.\n');
  await writeFile(path.join(root, 'old.txt'), 'remove me\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  await writeFile(
    path.join(root, 'app.ts'),
    `${lines(40, '// top')}\nconst value = 2;\n`,
  );
  await writeFile(path.join(root, 'notes.md'), '# Notes\n\nSecond draft.\n');
  await writeFile(path.join(root, 'added.ts'), 'export {};\n');
  await writeFile(path.join(root, 'src/lib/util.ts'), 'export const a = 2;\n');
  git('add', 'notes.md');
  git('rm', '-q', 'old.txt');
  ({ server } = await createViewer({ root, git: 'git' }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Server did not start');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

test('lists staged and working tree changes and opens their diffs', async ({
  page,
}) => {
  await page.goto(origin);
  const activity = page.getByRole('button', { name: /^Source Control/ });
  await expect(activity).toHaveAttribute(
    'aria-label',
    'Source Control (5 pending changes)',
  );
  // Explorer is the default view, as in VS Code.
  await expect(page.locator('#sidebar-title')).toHaveText('Explorer');
  await activity.click();
  await expect(activity).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#sidebar-title')).toHaveText('Source Control');
  await expect(page.locator('#status-branch')).toHaveText('main');
  const tree = page.getByRole('tree', { name: 'Source Control Changes' });
  await expect(tree.getByRole('treeitem')).toHaveText([
    /Staged Changes\s*2/,
    /notes\.md\s*M/,
    /old\.txt\s*D/,
    /Changes\s*3/,
    /added\.ts\s*U/,
    /app\.ts\s*M/,
    /util\.ts\s*src\/lib\s*M/,
  ]);
  await expect(
    tree.getByRole('treeitem', { name: 'old.txt, Index Deleted' }),
  ).toHaveClass(/deleted/);

  await tree
    .getByRole('treeitem', { name: 'notes.md, Index Modified' })
    .click();
  await expect(page.locator('.current-path')).toHaveText(
    'notes.md (HEAD ↔ Index)',
  );
  await expect(
    tree.getByRole('treeitem', { name: 'notes.md, Index Modified' }),
  ).toHaveAttribute('aria-selected', 'true');

  // A deleted file can be compared even though it cannot be opened.
  await tree.getByRole('treeitem', { name: 'old.txt, Index Deleted' }).click();
  await expect(page.locator('.current-path')).toHaveText(
    'old.txt (HEAD ↔ Index)',
  );
  await expect(
    page.locator('.diff-pane:not([hidden]) .diff-side.original .line-delete'),
  ).toHaveCount(2);

  // The keyboard moves through the tree; opening reveals the first change.
  await tree.getByRole('treeitem', { name: 'added.ts, Untracked' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(
    tree.getByRole('treeitem', { name: 'app.ts, Modified' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.current-path')).toHaveText(
    'app.ts (Index ↔ Working Tree)',
  );
  await expect(
    tree.getByRole('treeitem', { name: 'app.ts, Modified' }),
  ).toBeFocused();
  await expect
    .poll(() =>
      page
        .locator('.diff-pane:not([hidden]) .diff-scroll')
        .evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(0);

  await tree.getByRole('treeitem', { name: /^Staged Changes/ }).click();
  await expect(tree.getByRole('treeitem')).toHaveCount(5);
  await expect(
    tree.getByRole('treeitem', { name: /^Staged Changes/ }),
  ).toHaveAttribute('aria-expanded', 'false');
});

test('toggles the side bar with VS Code shortcuts and remembers it', async ({
  page,
}) => {
  await page.goto(origin);
  const sidebar = page.locator('#sidebar');
  await expect(sidebar).toBeVisible();
  await page.locator('#main').focus();
  await page.keyboard.press('Control+b');
  await expect(sidebar).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole('button', { name: /^Source Control/ }),
  ).toBeVisible();
  await expect(sidebar).toBeHidden();
  await page.keyboard.press('Control+Shift+G');
  await expect(sidebar).toBeVisible();
  await expect(
    page.getByRole('treeitem', { name: /^Staged Changes/ }),
  ).toBeFocused();
  await page.getByRole('button', { name: /^Source Control/ }).click();
  await expect(sidebar).toBeHidden();
  await page.locator('#status-branch').click();
  await expect(sidebar).toBeVisible();
});

test('browses visible project files with git decorations', async ({ page }) => {
  await page.goto(origin);
  await expect(page.locator('#sidebar-title')).toHaveText('Explorer');
  const tree = page.getByRole('tree', { name: 'Files Explorer' });
  // Folders come first; hidden files, node_modules, and deleted files are absent.
  await expect(tree.getByRole('treeitem')).toHaveText([
    'src',
    /added\.ts\s*U/,
    /app\.ts\s*M/,
    /notes\.md\s*M/,
  ]);
  const src = tree.locator('[data-path="src"]');
  await expect(src).toHaveAttribute('aria-expanded', 'false');
  await expect(src).toHaveClass(/git-modified/);
  await expect(src.locator('.codicon-circle-filled')).toHaveCount(1);
  await expect(tree.locator('[data-path="notes.md"]')).toHaveClass(
    /git-stage-modified/,
  );

  await src.click();
  await expect(src).toHaveAttribute('aria-expanded', 'true');
  await tree.locator('[data-path="src/lib"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tree.locator('[data-path="src/lib/util.ts"]')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.current-path')).toHaveText('src/lib/util.ts');
  await expect(tree.locator('[data-path="src/lib/util.ts"]')).toBeFocused();
  await expect(tree.locator('[data-path="src/lib/util.ts"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('ArrowLeft');
  await expect(tree.locator('[data-path="src/lib"]')).toBeFocused();

  // Revealing the active editor expands collapsed folders again.
  await tree.locator('[data-path="notes.md"]').click();
  await page
    .getByRole('button', { name: 'Collapse Folders in Explorer' })
    .click();
  await expect(tree.getByRole('treeitem')).toHaveCount(4);
  await page.getByRole('tab', { name: 'util.ts' }).click();
  await expect(tree.locator('[data-path="src/lib/util.ts"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.locator('#main').focus();
  await page.keyboard.press('Control+Shift+E');
  await expect(tree.locator('[data-path="src/lib/util.ts"]')).toBeFocused();
});

test('refreshes status and open diffs after staging', async ({ page }) => {
  await page.goto(origin);
  await page.getByRole('button', { name: /^Source Control/ }).click();
  const tree = page.getByRole('tree', { name: 'Source Control Changes' });
  await tree.getByRole('treeitem', { name: 'app.ts, Modified' }).click();
  await expect(
    page.locator('.diff-pane:not([hidden]) .char-insert'),
  ).toHaveText(['2']);
  git('add', 'app.ts');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(
    tree.getByRole('treeitem', { name: 'app.ts, Index Modified' }),
  ).toBeVisible();
  // The working tree diff now matches the index.
  await expect(
    page.locator('.diff-pane:not([hidden]) .diff-message'),
  ).toHaveText('No changes.');
});
