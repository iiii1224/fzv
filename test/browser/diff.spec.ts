import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  root = await mkdtemp(path.join(tmpdir(), 'fzv-diff-browser-'));
  git('init', '-q', '-b', 'main');
  await writeFile(
    path.join(root, 'app.ts'),
    `${lines(20, '// top')}\nconst value = 1;\nconst kept = true;\n${lines(20, '// bottom')}\n`,
  );
  await writeFile(path.join(root, 'notes.md'), '# Notes\n\nFirst draft.\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  await writeFile(
    path.join(root, 'app.ts'),
    `${lines(20, '// top')}\nconst value = 2;\nconst added = 'new';\nconst kept = true;\n${lines(20, '// bottom')}\n`,
  );
  await writeFile(path.join(root, 'notes.md'), '# Notes\n\nSecond draft.\n');
  git('add', 'notes.md');
  await writeFile(path.join(root, 'added.ts'), 'export const added = 1;\n');
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

async function openFile(page: Page, name: string) {
  await page.keyboard.press('/');
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.locator('.current-path')).toHaveText(name);
}

test('opens working tree changes side by side with character highlights', async ({
  page,
}) => {
  await page.goto(origin);
  await openFile(page, 'app.ts');
  await page.getByRole('button', { name: 'Open changes' }).click();
  await expect(page.locator('.current-path')).toHaveText(
    'app.ts (Index ↔ Working Tree)',
  );
  await expect(
    page.getByRole('tab', { name: 'app.ts (Working Tree)' }),
  ).toBeVisible();
  const pane = page.locator('.diff-pane:not([hidden])');
  const original = pane.locator('.diff-side.original');
  const modified = pane.locator('.diff-side.modified');
  // The changed digit is highlighted inside otherwise unchanged text.
  await expect(original.locator('.char-delete')).toHaveText(['1']);
  await expect(modified.locator('.char-insert').first()).toHaveText('2');
  await expect(modified.locator('.line-insert')).toHaveCount(2);
  // The added line has no counterpart and is padded on the original side.
  await expect(original.locator('.diagonal-fill')).toHaveCount(1);
  await expect(original.locator('.diff-row')).toHaveCount(
    await modified.locator('.diff-row').count(),
  );

  await page
    .getByRole('button', { name: 'Collapse unchanged regions' })
    .click();
  await expect(modified.locator('.diff-hidden-lines')).toHaveText([
    /17 hidden lines/,
    /19 hidden lines/,
  ]);
  await modified.locator('.diff-hidden-lines button').first().click();
  await expect(modified.locator('.diff-hidden-lines')).toHaveCount(1);

  await page.getByRole('button', { name: 'Inline view' }).click();
  const inline = pane.locator('.diff-side.inline');
  await expect(inline.locator('.line-delete')).toHaveCount(1);
  await expect(inline.locator('.line-insert')).toHaveCount(2);

  // The diff tab, its layout, and its options survive a reload.
  await page.reload();
  await expect(page.locator('.current-path')).toHaveText(
    'app.ts (Index ↔ Working Tree)',
  );
  await expect(
    page.getByRole('button', { name: 'Inline view' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('.diff-pane:not([hidden]) .diff-side.inline .line-insert'),
  ).toHaveCount(2);
});

test('navigates between changes and opens staged changes against HEAD', async ({
  page,
}) => {
  await page.goto(origin);
  await openFile(page, 'notes.md');
  await page.getByRole('button', { name: 'Open changes' }).click();
  await expect(page.locator('.current-path')).toHaveText(
    'notes.md (HEAD ↔ Index)',
  );
  const pane = page.locator('.diff-pane:not([hidden])');
  await expect(pane.locator('.char-delete')).toHaveText(['First']);
  await expect(pane.locator('.char-insert')).toHaveText(['Second']);
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.locator('.current-path')).toHaveText('notes.md');

  await openFile(page, 'app.ts');
  await page.getByRole('button', { name: 'Open changes' }).click();
  const scroller = page.locator('.diff-pane:not([hidden]) .diff-scroll');
  await page.setViewportSize({ width: 1000, height: 300 });
  await scroller.evaluate((element) => (element.scrollTop = 0));
  await page.locator('.tab.active .tab-select').focus();
  await page.keyboard.press(']');
  await page.keyboard.press('c');
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const original = page.locator('.diff-pane:not([hidden]) .diff-side.original');
  await expect
    .poll(
      async () =>
        (await original.evaluate((element) => element.scrollTop)) ===
        (await scroller.evaluate((element) => element.scrollTop)),
    )
    .toBe(true);
});

test('compares an untracked file against an empty original', async ({
  page,
}) => {
  await page.goto(origin);
  await openFile(page, 'added.ts');
  await page.getByRole('button', { name: 'Open changes' }).click();
  await expect(page.locator('.current-path')).toHaveText(
    'added.ts (Index ↔ Working Tree)',
  );
  const pane = page.locator('.diff-pane:not([hidden])');
  await expect(pane.locator('.diff-message')).toBeHidden();
  await expect(
    pane.locator('.diff-side.modified .diff-row.line-insert'),
  ).toHaveCount(2);
  // Syntax tokens split the inserted text into several spans.
  await expect
    .poll(async () =>
      (
        await pane.locator('.diff-side.modified .char-insert').allTextContents()
      ).join(''),
    )
    .toBe('export const added = 1;');
});
