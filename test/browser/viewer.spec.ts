import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
// @ts-expect-error Fixtures and compiled server are plain JavaScript, used only by tests.
import { createFixture } from '../fixtures.mjs';
// @ts-expect-error This intentionally tests built distribution files.
import { createViewer } from '../../dist/server/server.js';

let fixture: Awaited<ReturnType<typeof createFixture>>;
let server: import('node:http').Server;
let origin: string;
test.beforeAll(async () => {
  fixture = await createFixture();
  ({ server } = await createViewer({ root: fixture.root }));
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
  await fixture?.cleanup();
});
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(origin);
  await expect(page.locator('#status-project')).toHaveText('project');
  await page.keyboard.press('/');
  await expect(
    page.getByRole('button', { name: 'README.md', exact: true }),
  ).toBeVisible();
});

test('opens a minimal modal with root entries and drills into matching directories', async ({
  page,
}) => {
  await expect(page.locator('#menu-toggle')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'docs', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'docs/page.html', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('searchbox').fill('dcs');
  await page.getByRole('button', { name: 'docs', exact: true }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('docs/');
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'docs/page.html', exact: true }),
  ).toBeVisible();
  await page.getByRole('searchbox').press('Enter');
  await expect(page.getByRole('searchbox')).toHaveValue('docs/nested/');
  await expect(page.locator('.no-results')).toBeVisible();
  await page.getByRole('searchbox').press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('#main')).toBeFocused();
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await page.getByRole('searchbox').press('ArrowDown');
  await page.getByRole('searchbox').press('Enter');
  await expect(page.getByRole('searchbox')).toHaveValue('empty-directory/');
  await page
    .getByRole('button', { name: 'Close file search', exact: true })
    .click();
  await page.keyboard.press('/');
  await page.mouse.click(2, 2);
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('treats shortcut letters as text while searching and restores focus after opening a file', async ({
  page,
}) => {
  await openFile(page, 'README.md');
  await expect(
    page.getByRole('tab', { name: 'README.md', exact: true }),
  ).toBeFocused();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.keyboard.press('/');
  await page.getByRole('searchbox').pressSequentially('rf/hjklGgg');
  await expect(page.getByRole('searchbox')).toHaveValue('rf/hjklGgg');
  await expect(page.locator('.vim-hint')).toHaveCount(0);
  await page.getByRole('searchbox').press('Escape');
  expect(requests.filter((url) => url.includes('/file?'))).toEqual([]);
  await page.keyboard.press('/');
  await page.getByRole('searchbox').fill('hello 日本');
  await page.getByRole('searchbox').press('Enter');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(
    page.getByRole('tab', { name: 'docs/hello world 日本語.txt' }),
  ).toBeFocused();
});

test('copies a file path and the complete source text', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await openFile(page, 'docs/sample.ts');
  const pathLabel = page.locator('#current-path');
  const pathBounds = await pathLabel.boundingBox();
  const copyPath = page.getByRole('button', { name: 'Copy file path' });
  const copyBounds = await copyPath.boundingBox();
  expect(pathBounds).not.toBeNull();
  expect(copyBounds).not.toBeNull();
  expect(copyBounds!.x - (pathBounds!.x + pathBounds!.width)).toBeLessThan(12);
  await copyPath.click();
  await expect(page.locator('#notification')).toHaveText(
    'File path copied to clipboard.',
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'docs/sample.ts',
  );
  await page.evaluate(() => {
    const writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: () => {
        Object.defineProperty(navigator.clipboard, 'writeText', {
          configurable: true,
          value: writeText,
        });
        return Promise.reject(new Error('Clipboard API denied'));
      },
    });
  });
  await copyPath.click();
  await expect(page.locator('#notification')).toHaveText(
    'File path copied to clipboard.',
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'docs/sample.ts',
  );

  const source =
    'export const message: string = "<script>unsafe</script>";\r\n' +
    '// 日本語のコメント\r\n' +
    'console.log(message);\r\n';
  const copySource = page.getByRole('button', { name: 'Copy source code' });
  await expect(copySource).toBeVisible();
  await copySource.click();
  await expect(page.locator('#notification')).toHaveText(
    'Source copied to clipboard.',
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    source,
  );
});

test('shows keyboard help and supports Vim scrolling and search inside HTML previews', async ({
  page,
}) => {
  await openFile(page, 'README.md');
  await page.keyboard.press('Shift+Slash');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  await expect(help).toContainText('Scroll to the top');
  await expect(help).toContainText('Focus an editor group');
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();

  await openFile(page, 'docs/navigation.html');
  const frame = page.frameLocator('iframe[title="docs/navigation.html"]');
  await frame.locator('body').click({ position: { x: 100, y: 100 } });
  await page.keyboard.press('j');
  await expect
    .poll(() =>
      frame
        .locator('html')
        .evaluate(() => document.scrollingElement?.scrollTop ?? 0),
    )
    .toBeGreaterThan(0);
  await page.keyboard.press('Shift+Slash');
  const frameHelp = frame.getByRole('dialog', {
    name: 'Keyboard shortcuts',
  });
  await expect(frameHelp).toBeVisible();
  await expect(frameHelp).not.toContainText('Focus an editor group');
  await page.keyboard.press('Escape');
  await expect(frameHelp).toBeHidden();
  await page.keyboard.press('/');
  await expect(page.getByRole('dialog', { name: 'Find a file' })).toBeVisible();
});

test('restores saved tabs before the full file index finishes loading', async ({
  page,
}) => {
  await openFile(page, 'README.md');
  await openFile(page, 'docs/sample.ts');

  let releaseIndex!: () => void;
  const indexGate = new Promise<void>((resolve) => {
    releaseIndex = resolve;
  });
  let markRequestStarted!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  let markRequestContinued!: () => void;
  const requestContinued = new Promise<void>((resolve) => {
    markRequestContinued = resolve;
  });
  await page.route('**/api/files', async (route) => {
    markRequestStarted();
    await indexGate;
    await route.continue();
    markRequestContinued();
  });
  try {
    await page.reload();
    await requestStarted;
    await expect(page.getByRole('tab')).toHaveCount(2);
  } finally {
    releaseIndex();
  }
  await requestContinued;
  await page.unroute('**/api/files');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('#status-project')).toHaveText('project');
});

async function openFile(page: Page, file: string): Promise<void> {
  if (!(await page.getByRole('searchbox').isVisible()))
    await page.keyboard.press('/');
  await page.getByRole('searchbox').fill(file);
  await page.getByRole('button', { name: file, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

function editorGroup(page: Page, number: number): Locator {
  return page.getByRole('region', {
    name: `Editor group ${number}`,
    exact: true,
  });
}

async function groupPane(page: Page, group: Locator): Promise<Locator> {
  const id = await group.getAttribute('data-group-id');
  return page.locator(`.preview-pane[data-group-id="${id}"]:visible`);
}

async function dragTab(
  page: Page,
  tab: Locator,
  target: Locator,
  zone: 'left' | 'right' | 'up' | 'down' | 'center' | 'tab-end',
  copy = false,
): Promise<void> {
  const source = await tab.boundingBox();
  const box = await target.boundingBox();
  if (!source || !box) throw new Error('Missing drag bounds');
  const x =
    box.x +
    (zone === 'left'
      ? 8
      : zone === 'right' || zone === 'tab-end'
        ? box.width - 8
        : box.width / 2);
  const y =
    box.y +
    (zone === 'tab-end'
      ? 16
      : zone === 'up'
        ? 78
        : zone === 'down'
          ? box.height - 8
          : 70 + (box.height - 70) / 2);
  const modifier = await page.evaluate(() =>
    /Mac/.test(navigator.platform) ? 'Alt' : 'Control',
  );
  if (copy) await page.keyboard.down(modifier);
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    source.x + source.width / 2 + 12,
    source.y + source.height / 2,
    { steps: 3 },
  );
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.move(x + 1, y);
  await page.mouse.up();
  if (copy) await page.keyboard.up(modifier);
  await expect(page.locator('.editor-drag-surface')).toBeHidden();
}

test('reorders tabs by native drag and restores the order after reload', async ({
  page,
}) => {
  await openFile(page, 'README.md');
  await openFile(page, 'docs/image.svg');
  await openFile(page, 'docs/page.html');
  await dragTab(
    page,
    page.getByRole('tab', { name: 'README.md', exact: true }),
    editorGroup(page, 1),
    'tab-end',
  );
  const order = async () =>
    page
      .getByRole('tab')
      .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-label')));
  expect(await order()).toEqual([
    'docs/image.svg',
    'docs/page.html',
    'README.md',
  ]);
  await page.reload();
  await expect(page.getByRole('tab')).toHaveCount(3);
  expect(await order()).toEqual([
    'docs/image.svg',
    'docs/page.html',
    'README.md',
  ]);
});

test('splits in all four directions, nests groups, and collapses an empty group', async ({
  page,
}) => {
  await openFile(page, 'README.md');
  await openFile(page, 'docs/sample.ts');
  await dragTab(
    page,
    page.getByRole('tab', { name: 'docs/sample.ts', exact: true }),
    editorGroup(page, 1),
    'right',
  );
  await expect(page.locator('.editor-group')).toHaveCount(2);
  await expect(editorGroup(page, 1).getByRole('tab')).toHaveAttribute(
    'aria-label',
    'README.md',
  );
  await expect(editorGroup(page, 2).getByRole('tab')).toHaveAttribute(
    'aria-label',
    'docs/sample.ts',
  );
  await openFile(page, 'docs/sample.py');
  await dragTab(
    page,
    editorGroup(page, 2).getByRole('tab', {
      name: 'docs/sample.py',
      exact: true,
    }),
    editorGroup(page, 2),
    'down',
  );
  await expect(page.locator('.editor-group')).toHaveCount(3);
  const second = await editorGroup(page, 2).boundingBox();
  const third = await editorGroup(page, 3).boundingBox();
  expect(third!.y).toBeGreaterThan(second!.y);
  expect(third!.x).toBeCloseTo(second!.x, 0);
  await dragTab(
    page,
    editorGroup(page, 3).getByRole('tab'),
    editorGroup(page, 1),
    'left',
  );
  await expect(page.locator('.editor-group')).toHaveCount(3);
  await expect(editorGroup(page, 1).getByRole('tab')).toHaveAttribute(
    'aria-label',
    'docs/sample.py',
  );
  await dragTab(
    page,
    editorGroup(page, 1).getByRole('tab'),
    editorGroup(page, 2),
    'up',
  );
  await expect(page.locator('.editor-group')).toHaveCount(3);
  await expect(editorGroup(page, 1).getByRole('tab')).toHaveAttribute(
    'aria-label',
    'docs/sample.py',
  );
  const top = await editorGroup(page, 1).boundingBox();
  const bottom = await editorGroup(page, 2).boundingBox();
  expect(bottom!.y).toBeGreaterThan(top!.y);
  await editorGroup(page, 1)
    .getByRole('button', { name: 'Close docs/sample.py', exact: true })
    .click();
  await expect(page.locator('.editor-group')).toHaveCount(2);
  await expect(page.locator('.editor-sash')).toHaveCount(1);
});

test('copies tabs with a modifier, keeps modes independent, and opens files in the focused group', async ({
  page,
}) => {
  await openFile(page, 'README.md');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await dragTab(
    page,
    page.getByRole('tab', { name: 'README.md', exact: true }),
    editorGroup(page, 1),
    'right',
    true,
  );
  await expect(page.locator('.editor-group')).toHaveCount(2);
  await expect(
    page.getByRole('tab', { name: 'README.md', exact: true }),
  ).toHaveCount(2);
  await expect(page.locator('.source-text:visible')).toHaveCount(2);
  await editorGroup(page, 2)
    .getByRole('button', { name: 'Viewer', exact: true })
    .click();
  await expect(page.locator('.source-text:visible')).toHaveCount(1);
  await expect(page.locator('.markdown-preview:visible')).toHaveCount(1);
  await openFile(page, 'docs/sample.ts');
  await expect(editorGroup(page, 2).getByRole('tab')).toHaveCount(2);
  await editorGroup(page, 1).getByRole('tab').click();
  await openFile(page, 'docs/sample.py');
  await expect(editorGroup(page, 1).getByRole('tab')).toHaveCount(2);
  await page.keyboard.press('Alt+k');
  await expect(
    editorGroup(page, 1).getByRole('tab', { name: 'README.md', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(
    editorGroup(page, 2).getByRole('tab', {
      name: 'docs/sample.ts',
      exact: true,
    }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(page.locator('.editor-group')).toHaveCount(2);
  await expect(editorGroup(page, 1)).toHaveClass(/focused/);
  await expect(
    editorGroup(page, 1).getByRole('button', { name: 'Source', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    editorGroup(page, 2).getByRole('tab', {
      name: 'docs/sample.ts',
      exact: true,
    }),
  ).toHaveAttribute('aria-selected', 'true');
});

test('moving an HTML tab into a split and another group preserves its iframe and sandbox state', async ({
  page,
}) => {
  await openFile(page, 'README.md');
  await openFile(page, 'docs/navigation.html');
  const frame = page.frameLocator('iframe[title="docs/navigation.html"]');
  await frame
    .getByRole('textbox', { name: 'Text input', exact: true })
    .fill('retain this');
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await dragTab(
    page,
    page.getByRole('tab', { name: 'docs/navigation.html', exact: true }),
    editorGroup(page, 1),
    'right',
  );
  await expect(page.locator('.editor-group')).toHaveCount(2);
  await expect(
    frame.getByRole('textbox', { name: 'Text input', exact: true }),
  ).toHaveValue('retain this');
  await editorGroup(page, 1).getByRole('tab').click();
  await frame.getByRole('textbox', { name: 'Text input', exact: true }).click();
  await expect(editorGroup(page, 2)).toHaveClass(/focused/);
  await dragTab(
    page,
    editorGroup(page, 2).getByRole('tab'),
    editorGroup(page, 1),
    'center',
  );
  await expect(page.locator('.editor-group')).toHaveCount(1);
  await expect(
    frame.getByRole('textbox', { name: 'Text input', exact: true }),
  ).toHaveValue('retain this');
  expect(requests.filter((url) => url.includes('/preview-html?'))).toHaveLength(
    0,
  );
});

test('resizes columns and rows by pointer and keyboard, saves ratios, and supports split buttons', async ({
  page,
}) => {
  await openFile(page, 'README.md');
  await page
    .getByRole('button', { name: 'Split editor right', exact: true })
    .click();
  await expect(page.locator('.editor-group')).toHaveCount(2);
  const sash = page.getByRole('separator', { name: 'Resize editor columns' });
  const box = await sash.boundingBox();
  await page.mouse.move(box!.x + 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 130, box!.y + box!.height / 2, { steps: 8 });
  await page.mouse.up();
  const width = (await editorGroup(page, 1).boundingBox())!.width;
  expect(width).toBeGreaterThan(700);
  await page.reload();
  await expect(page.locator('.editor-group')).toHaveCount(2);
  expect((await editorGroup(page, 1).boundingBox())!.width).toBeCloseTo(
    width,
    0,
  );
  await sash.press('ArrowLeft');
  expect((await editorGroup(page, 1).boundingBox())!.width).toBeLessThan(
    width - 40,
  );
  await editorGroup(page, 2)
    .getByRole('button', { name: 'Split editor down', exact: true })
    .click();
  const row = page.getByRole('separator', { name: 'Resize editor rows' });
  await expect(row).toBeVisible();
  const before = Number(await row.getAttribute('aria-valuenow'));
  await row.press('ArrowDown');
  expect(Number(await row.getAttribute('aria-valuenow'))).toBeGreaterThan(
    before,
  );
  await page.screenshot({
    path: test.info().outputPath('split-workspace.png'),
  });
});

test('PDF search and zoom shortcuts affect only the focused group', async ({
  page,
}) => {
  await openFile(page, 'docs/example.pdf');
  await expect(page.locator('.pdf-status')).toHaveText('1 / 3');
  await page
    .getByRole('button', { name: 'Split editor right', exact: true })
    .click();
  await expect(page.locator('.pdf-status')).toHaveText(['1 / 3', '1 / 3']);
  const first = await groupPane(page, editorGroup(page, 1));
  const second = await groupPane(page, editorGroup(page, 2));
  await second
    .getByRole('region', { name: 'PDF document', exact: true })
    .click({ position: { x: 30, y: 100 } });
  const firstZoom = await first.locator('.pdf-zoom').textContent();
  const secondZoom = await second.locator('.pdf-zoom').textContent();
  await page.keyboard.press('Control+Equal');
  await expect(second.locator('.pdf-zoom')).not.toHaveText(secondZoom!);
  await expect(first.locator('.pdf-zoom')).toHaveText(firstZoom!);
  await page.keyboard.press('Control+f');
  await expect(
    second.getByRole('textbox', { name: 'Find in PDF' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await first
    .getByRole('region', { name: 'PDF document', exact: true })
    .click({ position: { x: 30, y: 100 } });
  await page.keyboard.press('Control+f');
  await expect(
    first.getByRole('textbox', { name: 'Find in PDF' }),
  ).toBeFocused();
});

test('merges duplicate files, avoids empty self-splits, and cancels dragging cleanly', async ({
  page,
}) => {
  await openFile(page, 'README.md');
  await page
    .getByRole('button', { name: 'Split editor right', exact: true })
    .click();
  await editorGroup(page, 1).getByRole('tab').click();
  await openFile(page, 'docs/sample.ts');
  await dragTab(
    page,
    editorGroup(page, 2).getByRole('tab'),
    editorGroup(page, 1),
    'tab-end',
    true,
  );
  await expect(page.getByRole('tab')).toHaveCount(3);
  expect(
    await editorGroup(page, 1)
      .getByRole('tab')
      .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-label'))),
  ).toEqual(['docs/sample.ts', 'README.md']);
  await dragTab(
    page,
    editorGroup(page, 2).getByRole('tab'),
    editorGroup(page, 1),
    'center',
  );
  await expect(page.locator('.editor-group')).toHaveCount(1);
  await page
    .getByRole('button', { name: 'Close docs/sample.ts', exact: true })
    .click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await dragTab(page, page.getByRole('tab'), editorGroup(page, 1), 'right');
  await expect(page.locator('.editor-group')).toHaveCount(1);
  const box = await page.getByRole('tab').boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 15);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 15, box!.y + 15, {
    steps: 3,
  });
  await page.mouse.move(1000, 400, { steps: 8 });
  await expect(page.locator('.editor-drag-surface')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.editor-drag-surface')).toBeHidden();
  await expect(page.locator('.editor-area')).not.toHaveClass(/dragging-tab/);
  await expect(page.locator('.editor-group')).toHaveCount(1);
  await openFile(page, 'docs/sample.ts');
  await page.keyboard.press('Control+Backslash');
  await expect(page.locator('.editor-group')).toHaveCount(2);
  await page.keyboard.press('Control+Shift+Backslash');
  await expect(page.locator('.editor-group')).toHaveCount(3);
});

test('moving a PDF retains its loaded view, zoom, search and current page', async ({
  page,
}) => {
  await openFile(page, 'README.md');
  await openFile(page, 'docs/example.pdf');
  await expect(page.locator('.pdf-status')).toHaveText('1 / 3');
  await page.getByRole('button', { name: 'Zoom in PDF', exact: true }).click();
  await page.getByRole('textbox', { name: 'Find in PDF' }).fill('preview');
  await expect(page.locator('.pdf-matches')).toHaveText(/1 \/ 3/);
  const scroll = page.locator('.pdf-scroll');
  await scroll.evaluate((element) => {
    element.dataset.retained = 'yes';
    element.scrollTop = element.scrollHeight - element.clientHeight;
  });
  await expect(page.locator('.pdf-status')).toHaveText('3 / 3');
  const zoom = await page.locator('.pdf-zoom').textContent();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await dragTab(
    page,
    page.getByRole('tab', { name: 'docs/example.pdf', exact: true }),
    editorGroup(page, 1),
    'right',
  );
  await expect(page.locator('.editor-group')).toHaveCount(2);
  await expect(scroll).toHaveAttribute('data-retained', 'yes');
  await expect(page.locator('.pdf-status')).toHaveText('3 / 3');
  await expect(page.locator('.pdf-zoom')).toHaveText(zoom!);
  await expect(page.getByRole('textbox', { name: 'Find in PDF' })).toHaveValue(
    'preview',
  );
  expect(
    requests.filter((url) => url.includes('/file?path=docs%2Fexample.pdf')),
  ).toHaveLength(0);
});

test('migrates old tabs and prunes missing files and empty branches when restoring splits', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { project } = await (await fetch('/api/files')).json();
    localStorage.removeItem(`fzv:project:${project.id}:v2`);
    localStorage.setItem(
      `fzv:project:${project.id}:v1`,
      JSON.stringify({
        version: 1,
        tabs: ['README.md', 'missing.txt', 'docs/sample.ts', 'README.md'],
        active: 'docs/sample.ts',
      }),
    );
  });
  await page.reload();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(
    page.getByRole('tab', { name: 'docs/sample.ts', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(async () => {
    const { project } = await (await fetch('/api/files')).json();
    localStorage.setItem(
      `fzv:project:${project.id}:v2`,
      JSON.stringify({
        version: 2,
        layout: {
          type: 'split',
          id: 's',
          axis: 'x',
          ratio: 0.6,
          children: [
            { type: 'group', id: 'a' },
            { type: 'group', id: 'b' },
          ],
        },
        groups: [
          {
            id: 'a',
            tabs: [{ path: 'missing.txt', mode: 'source' }],
            active: 'missing.txt',
          },
          {
            id: 'b',
            tabs: [{ path: 'README.md', mode: 'source' }],
            active: 'README.md',
          },
        ],
        activeGroup: 'a',
      }),
    );
  });
  await page.reload();
  await expect(page.locator('.editor-group')).toHaveCount(1);
  await expect(page.locator('.editor-sash')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveAttribute(
    'aria-label',
    'README.md',
  );
  await expect(page.locator('.source-text:visible')).toContainText(
    '# Example project',
  );
  await page
    .getByRole('button', { name: 'Close README.md', exact: true })
    .click();
  await expect(page.locator('.editor-group')).toHaveCount(1);
  await expect(page.locator('.empty-state:visible')).toBeVisible();
});

test('finds files, navigates results by keyboard, and safely renders text', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('dialog', { name: 'Find a file' })).toBeVisible();
  await page.getByRole('searchbox').fill('hello 日本');
  await page.getByRole('searchbox').press('Enter');
  await expect(
    page.getByRole('tab', { name: 'docs/hello world 日本語.txt' }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.text-preview:visible')).toContainText(
    '<unsafe> is plain text.',
  );
  await page.keyboard.press('/');
  await page.getByRole('searchbox').fill('script');
  await page.getByRole('searchbox').press('Enter');
  await expect(page.getByRole('tab', { name: 'x <script>.txt' })).toBeVisible();
  await expect(page.locator('.text-preview:visible')).toHaveText(
    'A safe filename.',
  );
  expect(errors).toEqual([]);
});
test('persists tab order and selection and handles close and keyboard switching', async ({
  page,
}) => {
  await openFile(page, 'README.md');
  await openFile(page, 'docs/image.svg');
  await openFile(page, 'docs/page.html');
  await page.getByRole('tab', { name: 'docs/image.svg', exact: true }).click();
  const before = await page.getByRole('tab').allTextContents();
  await page.reload();
  await expect(page.getByRole('tab')).toHaveCount(3);
  expect(await page.getByRole('tab').allTextContents()).toEqual(before);
  await expect(
    page.getByRole('tab', { name: 'docs/image.svg', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Alt+j');
  await expect(
    page.getByRole('tab', { name: 'docs/page.html' }),
  ).toHaveAttribute('aria-selected', 'true');
  await page
    .getByRole('button', { name: 'Close docs/page.html', exact: true })
    .click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page
    .getByRole('tab', { name: 'docs/image.svg', exact: true })
    .press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'README.md' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
test('switches Markdown between rendered viewer and exact source without refetching', async ({
  page,
}) => {
  await openFile(page, 'README.md');
  await expect(
    page.getByRole('heading', { name: 'Example project', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Viewer', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('.source-text:visible')).toHaveText(
    '# Example project\n\nBuild with an agent. Browse with fzv.\n',
  );
  await expect(page.locator('.line-numbers:visible')).toHaveText('1\n2\n3\n4');
  await expect(
    page.getByRole('button', { name: 'Source', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await openFile(page, 'docs/image.svg');
  await expect(page.getByRole('group', { name: 'Preview mode' })).toBeHidden();
  await page.getByRole('tab', { name: 'README.md', exact: true }).click();
  await expect(page.locator('.source-text:visible')).toBeVisible();
  await page.keyboard.press('r');
  await expect(page.locator('.source-text:visible')).toContainText(
    '# Example project',
  );
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Example project', exact: true }),
  ).toBeVisible();
  expect(
    requests.filter((url) => url.includes('/file?path=README.md')),
  ).toHaveLength(1);
});

test('renders Markdown tables and local images while removing active HTML and unsafe links', async ({
  page,
}) => {
  const content =
    '# Safe Markdown\n\n**Bold** and `code`\n\n| Key | Value |\n| --- | --- |\n| a | b |\n\n![Local image](image.svg)\n\n[Project file](hello%20world%20%E6%97%A5%E6%9C%AC%E8%AA%9E.txt)\n\n<script>document.body.dataset.intrusion="yes"</script>\n\n<img src="missing.png" onerror="document.body.dataset.intrusion=\'yes\'">\n\n<a href="javascript:alert(1)">Unsafe link</a>\n\n<iframe src="/api/files"></iframe>\n\n<div id="search" class="topbar" style="position:fixed">Raw HTML</div>\n';
  // A nested path is important for resolving relative images and links.
  await writeFile(path.join(fixture.root, 'docs', 'mode-preview.md'), content);
  await page.getByRole('button', { name: 'Refresh file list' }).click();
  await openFile(page, 'docs/mode-preview.md');
  const article = page.locator('.markdown-preview:visible');
  await expect(
    article.getByRole('heading', { name: 'Safe Markdown' }),
  ).toBeVisible();
  await expect(article.locator('table td')).toHaveText(['a', 'b']);
  await expect(
    article.getByRole('img', { name: 'Local image' }),
  ).toHaveJSProperty('naturalWidth', 480);
  await expect(
    article.getByRole('link', { name: 'Project file' }),
  ).toHaveAttribute(
    'href',
    '/asset/docs/hello%20world%20%E6%97%A5%E6%9C%AC%E8%AA%9E.txt',
  );
  await expect(
    article.locator('script, iframe, [onerror], [style], [id], [class]'),
  ).toHaveCount(0);
  await expect(
    article.getByText('Unsafe link', { exact: true }),
  ).not.toHaveAttribute('href', /./);
  await expect(page.locator('body')).not.toHaveAttribute(
    'data-intrusion',
    'yes',
  );
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('.source-text:visible')).toHaveText(content);
});

test('opens plain text and empty files in source mode only', async ({
  page,
}) => {
  await openFile(page, 'docs/hello world 日本語.txt');
  await expect(page.locator('.source-text:visible')).toHaveText(
    'Hello, project!\n<unsafe> is plain text.\n',
  );
  await expect(page.getByRole('group', { name: 'Preview mode' })).toBeHidden();
  await expect(page.locator('.viewer-surface')).toHaveCount(0);
  await expect(page.locator('.source-text:visible')).toHaveCSS(
    'white-space',
    'pre',
  );
  await openFile(page, 'empty.txt');
  await expect(page.getByRole('group', { name: 'Preview mode' })).toBeHidden();
  await expect(page.locator('.source-text:visible')).toBeEmpty();
  await expect(page.locator('.line-numbers:visible')).toHaveText('1');
});

test('opens source files with VS Code syntax colors and preserves exact text on reload and restore', async ({
  page,
}) => {
  const violations: string[] = [];
  await page.exposeFunction('recordViolation', (directive: string) =>
    violations.push(directive),
  );
  await page.evaluate(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      // @ts-expect-error The test exposes this function on the browser window.
      void window.recordViolation(event.violatedDirective);
    });
  });
  await openFile(page, 'docs/sample.ts');
  const source = page.locator('.source-text:visible');
  const content =
    'export const message: string = "<script>unsafe</script>";\r\n// 日本語のコメント\r\nconsole.log(message);\r\n';
  await expect(source).toHaveAttribute('data-language', 'typescript');
  expect(await source.textContent()).toBe(content);
  await expect(source.locator('script')).toHaveCount(0);
  await expect(
    source.locator('.syntax-token').filter({ hasText: /^const$/ }),
  ).toHaveCSS('color', 'rgb(0, 0, 255)');
  await expect(
    source
      .locator('.syntax-token')
      .filter({ hasText: /^\/\/ 日本語のコメント$/ }),
  ).toHaveCSS('color', 'rgb(0, 128, 0)');
  await expect(page.getByRole('group', { name: 'Preview mode' })).toBeHidden();
  await expect(page.locator('.viewer-surface')).toHaveCount(0);
  await openFile(page, 'README.md');
  await expect(
    page.getByRole('button', { name: 'Viewer', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', { name: 'docs/sample.ts', exact: true }).click();
  await page.keyboard.press('r');
  await expect(source).toHaveAttribute('data-language', 'typescript');
  expect(await source.textContent()).toBe(content);
  await page.reload();
  await expect(source).toHaveAttribute('data-language', 'typescript');
  await expect(page.getByRole('group', { name: 'Preview mode' })).toBeHidden();
  expect(violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('source-preview.png') });
});

test('highlights supported languages and keeps large sources readable', async ({
  page,
}) => {
  for (const [file, language] of [
    ['sample.py', 'python'],
    ['sample.json', 'json'],
    ['sample.css', 'css'],
  ]) {
    await openFile(page, `docs/${file}`);
    const source = page.locator('.source-text:visible');
    await expect(source).toHaveAttribute('data-language', language);
    expect(await source.locator('.syntax-token').count()).toBeGreaterThan(1);
    await expect(
      page.getByRole('group', { name: 'Preview mode' }),
    ).toBeHidden();
  }
  const content =
    '// large source\n' + 'export const item = 1;\n'.repeat(25000);
  await page.route('**/file?path=docs%2Fsample.ts&*', (route) =>
    route.fulfill({ contentType: 'text/plain', body: content }),
  );
  await openFile(page, 'docs/sample.ts');
  await expect(page.locator('.source-text:visible')).toHaveText(content);
  await expect(page.locator('.source-text:visible .syntax-token')).toHaveCount(
    0,
  );
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox')).toBeFocused();
});

test('uses VS Code Light Modern tabs and Quick Input styling', async ({
  page,
}) => {
  await expect(page.locator('.quick-input-widget')).toHaveCSS(
    'background-color',
    'rgb(248, 248, 248)',
  );
  await expect(page.locator('.quick-input-widget')).toHaveCSS('top', '8px');
  await expect(page.locator('.quick-input-box')).toHaveCSS(
    'border-radius',
    '2px',
  );
  await expect(page.locator('.quick-input-box')).toHaveCSS('height', '28px');
  await page.screenshot({ path: test.info().outputPath('quick-input.png') });
  await openFile(page, 'README.md');
  await expect(page.locator('.tabs-container')).toHaveCSS('height', '35px');
  await expect(page.locator('.tab.active')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await expect(page.locator('.tab.active')).toHaveCSS(
    'color',
    'rgb(59, 59, 59)',
  );
});

test('switches HTML to raw source and restores its sandboxed viewer', async ({
  page,
}) => {
  await openFile(page, 'docs/page.html');
  const frame = page.frameLocator('iframe[title="docs/page.html"]');
  await expect(
    frame.getByRole('heading', { name: 'Relative HTML preview' }),
  ).toBeVisible();
  await frame
    .locator('body')
    .evaluate((body) => (body.dataset.modeTest = 'retained'));
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('.source-text:visible')).toContainText(
    '<html><head><base href="https://example.invalid/">',
  );
  await expect(page.locator('.source-text script')).toHaveCount(0);
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();
  await expect(frame.locator('body')).toHaveAttribute(
    'data-mode-test',
    'retained',
  );
  await expect(page.locator('iframe[title="docs/page.html"]')).toHaveAttribute(
    'sandbox',
    'allow-scripts',
  );
});

test('loads bundled VS Code icons without external assets', async ({
  page,
}) => {
  await expect(
    page
      .getByRole('button', { name: 'docs', exact: true })
      .locator('.codicon-folder'),
  ).toBeVisible();
  await expect(
    page
      .getByRole('button', { name: 'README.md', exact: true })
      .locator('.codicon-markdown'),
  ).toBeVisible();
  await openFile(page, 'README.md');
  await expect(
    page
      .getByRole('tab', { name: 'README.md', exact: true })
      .locator('.codicon-markdown'),
  ).toBeVisible();
  expect(
    await page.evaluate(async () => {
      await document.fonts.load('16px codicon');
      return document.fonts.check('16px codicon');
    }),
  ).toBe(true);
});
test('loads HTML assets relative to the file and isolates scripts from the app', async ({
  page,
}) => {
  await openFile(page, 'docs/page.html');
  const frame = page.frameLocator('iframe[title="docs/page.html"]');
  await expect(
    frame.getByRole('heading', { name: 'Relative HTML preview' }),
  ).toBeVisible();
  await expect(frame.locator('body')).toHaveAttribute('data-script-ran', 'yes');
  await expect(frame.locator('body')).toHaveAttribute(
    'data-storage-blocked',
    'yes',
  );
  await expect(frame.locator('body')).toHaveAttribute(
    'data-parent-blocked',
    'yes',
  );
  await expect(frame.locator('body')).toHaveCSS(
    'background-color',
    'rgb(245, 240, 232)',
  );
  await expect(frame.locator('img')).toHaveJSProperty('naturalWidth', 480);
  await expect(page.locator('body')).not.toHaveAttribute(
    'data-intrusion',
    'yes',
  );
  expect(
    await page.evaluate(() => localStorage.getItem('intrusion')),
  ).toBeNull();
});
test('zooms, drags, resets images, and reloads only the active file', async ({
  page,
}) => {
  await openFile(page, 'README.md');
  await openFile(page, 'docs/image.svg');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('.image-zoom-value')).toHaveText('125%');
  const stage = page.locator('.image-stage');
  const box = await stage.boundingBox();
  if (!box) throw new Error('Image stage absent');
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 140);
  await page.mouse.up();
  await expect(stage.locator('img')).toHaveCSS(
    'transform',
    /matrix\(1.25, 0, 0, 1.25, 50, 40\)/,
  );
  await page.getByRole('button', { name: 'Fit image to viewer' }).click();
  await expect(page.locator('.image-zoom-value')).toHaveText('100%');
  await writeFile(path.join(fixture.root, 'README.md'), '# Changed on disk\n');
  await page.getByRole('tab', { name: 'README.md' }).click();
  await expect(page.locator('.markdown-preview')).toContainText(
    'Example project',
  );
  await page.keyboard.press('r');
  await expect(page.locator('.markdown-preview')).toHaveText('Changed on disk');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await writeFile(path.join(fixture.root, 'README.md'), '# Example project\n');
});
test('requests PDFs and supports search toggling and refreshing added files', async ({
  page,
}) => {
  const request = page.waitForResponse(
    (response) =>
      response.url().includes('/file?path=docs%2Fexample.pdf') &&
      response.request().method() === 'GET',
  );
  await openFile(page, 'docs/example.pdf');
  expect((await request).status()).toBe(200);
  await expect(page.locator('.pdf-scroll .page canvas').first()).toBeVisible();
  await expect(page.getByRole('searchbox')).toBeHidden();
  await page.getByRole('tab', { name: 'docs/example.pdf' }).focus();
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox')).toBeFocused();
  await writeFile(path.join(fixture.root, 'new-note.md'), 'New file');
  await page.getByRole('button', { name: 'Refresh file list' }).click();
  await expect(
    page.getByRole('button', { name: 'new-note.md', exact: true }),
  ).toBeVisible();
});

test('renders PDFs locally with text, links, Vim scrolling, zoom and document search', async ({
  page,
}) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => requests.push(request.url()));
  await openFile(page, 'README.md');
  expect(requests.some((url) => /\/pdfjs\/|\/assets\/pdf-/.test(url))).toBe(
    false,
  );
  await openFile(page, 'docs/example.pdf');
  const scroller = page.locator('.pdf-scroll');
  await expect(page.locator('.pdf-status')).toHaveText('1 / 3');
  await expect(scroller.locator('.textLayer').first()).toContainText(
    'fzv preview page 1',
  );
  const canvas = scroller.locator('canvas').first();
  await expect(canvas).toBeVisible();
  expect(
    await canvas.evaluate((el) => {
      const data = el
        .getContext('2d')!
        .getImageData(0, 0, el.width, el.height).data;
      return data.some((value, index) => index % 4 !== 3 && value < 200);
    }),
  ).toBe(true);
  const link = scroller.locator('.annotationLayer a').first();
  await expect(link).toHaveAttribute('href', 'https://example.com/');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(page.workers()).toHaveLength(1);
  expect(
    requests.some((url) => url.includes('/pdfjs/build/pdf.worker.mjs')),
  ).toBe(true);
  expect(requests.some((url) => url.includes('/pdfjs/standard_fonts/'))).toBe(
    true,
  );
  const toolbar = await page.locator('.preview-toolbar').boundingBox();
  await scroller.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('j');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(64);
  await page.keyboard.press('k');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0);
  await page.getByRole('button', { name: 'Zoom in PDF', exact: true }).click();
  await page.keyboard.press('l');
  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBe(64);
  await page.keyboard.press('h');
  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBe(0);
  await page.keyboard.press('G');
  await expect
    .poll(() =>
      scroller.evaluate((el) =>
        Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop),
      ),
    )
    .toBeLessThanOrEqual(1);
  await expect(
    scroller.locator('.page[data-page-number="3"] canvas'),
  ).toBeVisible();
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0);
  expect(await page.locator('.preview-toolbar').boundingBox()).toEqual(toolbar);
  await page.getByRole('button', { name: 'Fit PDF to width' }).click();
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeLessThanOrEqual(1);
  await page.keyboard.press('f');
  const hintTarget = await link.evaluate(
    (el) =>
      el.id ||
      el.getAttribute('aria-label') ||
      el.textContent?.trim() ||
      el.tagName,
  );
  await expect(
    page.locator(`.vim-hint[data-hint-target=${JSON.stringify(hintTarget)}]`),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+f');
  const find = page.getByRole('textbox', { name: 'Find in PDF' });
  await expect(find).toBeFocused();
  await find.fill('page 3');
  await expect(page.locator('.pdf-matches')).toHaveText('1 / 1');
  await expect(
    scroller.locator('.page[data-page-number="3"] .highlight.selected'),
  ).toBeVisible();
  await find.fill('hjklGggf/r');
  await expect(find).toHaveValue('hjklGggf/r');
  await expect(page.locator('.pdf-matches')).toHaveText('No matches');
  await find.press('Escape');
  await expect(scroller).toBeFocused();
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox')).toBeFocused();
  expect(requests.every((url) => url.startsWith(origin + '/'))).toBe(true);
  expect(errors).toEqual([]);
});

test('zooms only the PDF with Ctrl+wheel and scrolls normally without Ctrl', async ({
  page,
}) => {
  await openFile(page, 'docs/example.pdf');
  const scroller = page.locator('.pdf-scroll');
  const firstPage = scroller.locator('.page').first();
  await expect(firstPage.locator('canvas')).toBeVisible();
  const zoom = () => page.locator('.pdf-zoom').innerText().then(parseFloat);
  const initialZoom = await zoom();
  const initialWidth = await firstPage.evaluate((el) => el.clientWidth);
  const toolbar = await page.locator('.preview-toolbar').boundingBox();
  const browserSize = () =>
    page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      pixelRatio: devicePixelRatio,
      scale: visualViewport?.scale,
    }));
  const initialBrowserSize = await browserSize();
  const box = await scroller.boundingBox();
  if (!box) throw new Error('PDF scroll area is missing');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 200);
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  expect(await zoom()).toBe(initialZoom);
  const cancelled = page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        window.addEventListener(
          'wheel',
          (event) => resolve(event.defaultPrevented),
          { once: true },
        );
      }),
  );
  await page.keyboard.down('Control');
  try {
    await page.mouse.wheel(0, -100);
    expect(await cancelled).toBe(true);
    await expect.poll(zoom).toBeGreaterThan(initialZoom);
    await expect
      .poll(() => firstPage.evaluate((el) => el.clientWidth))
      .toBeGreaterThan(initialWidth);
    const enlargedZoom = await zoom();
    await page.mouse.wheel(0, 100);
    await expect.poll(zoom).toBeLessThan(enlargedZoom);
  } finally {
    await page.keyboard.up('Control');
  }
  expect(await browserSize()).toEqual(initialBrowserSize);
  expect(await page.locator('.preview-toolbar').boundingBox()).toEqual(toolbar);
});

test('retains PDF tabs, reloads documents and releases workers on close', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openFile(page, 'docs/example.pdf');
  const pdf = page.locator('.pdf-scroll');
  await expect(pdf.locator('canvas').first()).toBeVisible();
  await page.keyboard.press('j');
  await expect.poll(() => pdf.evaluate((el) => el.scrollTop)).toBe(64);
  await openFile(page, 'README.md');
  await page.getByRole('tab', { name: 'docs/example.pdf' }).click();
  await expect.poll(() => pdf.evaluate((el) => el.scrollTop)).toBe(64);
  await page.keyboard.press('r');
  await expect(pdf.locator('canvas').first()).toBeVisible();
  await expect.poll(() => pdf.evaluate((el) => el.scrollTop)).toBe(0);
  await expect.poll(() => page.workers().length).toBe(1);
  await page.getByRole('tab', { name: 'README.md', exact: true }).click();
  await page.reload();
  await expect(page.locator('.markdown-preview')).toBeVisible();
  await page.getByRole('tab', { name: 'docs/example.pdf' }).click();
  await expect(pdf.locator('canvas').first()).toBeVisible();
  await expect
    .poll(() => pdf.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => pdf.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole('button', { name: 'Close docs/example.pdf', exact: true })
    .click();
  await expect(pdf).toHaveCount(0);
  await expect.poll(() => page.workers().length).toBe(0);
  expect(errors).toEqual([]);
});

test('reports PDF load errors and can reload or close during loading', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const pattern = '**/file?path=docs%2Fexample.pdf&*';
  await page.route(pattern, (route) =>
    route.fulfill({ contentType: 'application/pdf', body: 'not a PDF' }),
  );
  await openFile(page, 'docs/example.pdf');
  await expect(page.locator('.preview-error')).toContainText(
    'Could not load docs/example.pdf',
  );
  await expect(page.locator('#open-file')).toHaveAttribute(
    'href',
    /\/file\?path=docs%2Fexample.pdf/,
  );
  await expect.poll(() => page.workers().length).toBe(0);
  await page.unroute(pattern);
  await page.keyboard.press('r');
  await expect(page.locator('.pdf-scroll canvas').first()).toBeVisible();
  await page.keyboard.press('r');
  await page.keyboard.press('r');
  await page
    .getByRole('button', { name: 'Close docs/example.pdf', exact: true })
    .click();
  await expect.poll(() => page.workers().length).toBe(0);
  expect(errors).toEqual([]);
});

test('remains usable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('searchbox')).toBeHidden();
  await page.getByRole('button', { name: 'Find a file', exact: false }).click();
  await openFile(page, 'README.md');
  await expect(page.getByRole('searchbox')).toBeHidden();
  await expect(page.locator('.markdown-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('.source-text:visible')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('separates and restores project sessions when the same origin serves another root', async ({
  page,
}) => {
  await openFile(page, 'README.md');
  await openFile(page, 'docs/image.svg');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Server did not start');
  const port = address.port;
  const restart = async (root: string) => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    ({ server } = await createViewer({ root }));
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
  };
  try {
    await restart(path.join(fixture.root, 'docs'));
    await page.reload();
    await expect(page.locator('#project-name')).toHaveText('docs');
    await expect(page.getByRole('tab')).toHaveCount(0);
    await openFile(page, 'image.svg');
    await expect(page.getByRole('tab')).toHaveCount(1);
  } finally {
    await restart(fixture.root);
  }
  await page.reload();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(
    page.getByRole('tab', { name: 'docs/image.svg', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
});

test('switches and persists VS Code light/dark themes without refetching or replacing source', async ({
  page,
}) => {
  await openFile(page, 'docs/sample.ts');
  const source = page.locator('.source-text:visible');
  await expect(source).toHaveAttribute('data-language', 'typescript');
  const keyword = source
    .locator('.syntax-token')
    .filter({ hasText: /^const$/ });
  await expect(keyword).toHaveCSS('color', 'rgb(0, 0, 255)');
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await source.evaluate((element) => (element.dataset.originalNode = 'yes'));
  await page
    .getByRole('button', { name: 'Switch to dark theme', exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.source-preview')).toHaveCSS(
    'background-color',
    'rgb(31, 31, 31)',
  );
  await expect(keyword).toHaveCSS('color', 'rgb(86, 156, 214)');
  await expect(source).toHaveAttribute('data-original-node', 'yes');
  expect(requests.filter((url) => url.includes('/file?'))).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('dark-source.png') });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(keyword).toHaveCSS('color', 'rgb(86, 156, 214)');
  await openFile(page, 'README.md');
  await expect(page.locator('.quick-input-widget')).toBeHidden();
  await expect(page.locator('.markdown-preview')).toHaveCSS(
    'color',
    'rgb(204, 204, 204)',
  );
  await page.keyboard.press('/');
  await expect(page.locator('.quick-input-widget')).toHaveCSS(
    'background-color',
    'rgb(34, 34, 34)',
  );
  await expect(page.locator('.result.keyboard-selected')).toHaveCSS(
    'background-color',
    'rgb(4, 57, 94)',
  );
  await expect(page.locator('.result.keyboard-selected')).toHaveCSS(
    'color',
    'rgb(255, 255, 255)',
  );
  await expect(page.locator('.result.active')).toHaveCSS(
    'color',
    'rgb(255, 255, 255)',
  );
  await page.screenshot({
    path: test.info().outputPath('dark-quick-input.png'),
  });
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Switch to light theme', exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.markdown-preview')).toHaveCSS(
    'color',
    'rgb(59, 59, 59)',
  );
});

test('follows the system theme until explicitly selected and tolerates unavailable storage', async ({
  page,
}) => {
  await page.keyboard.press('Escape');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('denied');
      },
    }),
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('uses f hints to focus nested editor groups without changing their selected tabs', async ({
  page,
}) => {
  await openFile(page, 'docs/sample.ts');
  await page
    .getByRole('button', { name: 'Split editor right', exact: true })
    .click();
  await openFile(page, 'README.md');
  await editorGroup(page, 2)
    .getByRole('button', { name: 'Split editor down', exact: true })
    .click();
  const first = editorGroup(page, 1);
  const second = editorGroup(page, 2);
  const third = editorGroup(page, 3);
  const control = first.getByRole('button', {
    name: 'Focus editor group 1',
    exact: true,
  });
  const hint = page.locator(
    `.vim-hint[data-hint-target="${await control.getAttribute('id')}"]`,
  );
  await page.keyboard.press('f');
  await expect(hint).toBeVisible();
  await expect(
    page.locator('.vim-hint[data-hint-target^="group-focus"]'),
  ).toHaveCount(3);
  await page.keyboard.type((await hint.textContent())!.toLowerCase());
  await expect(first).toHaveClass(/focused/);
  await expect(
    first.getByRole('tab', { name: 'docs/sample.ts', exact: true }),
  ).toBeFocused();
  await expect(
    second.getByRole('tab', { name: 'README.md', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(
    third.getByRole('tab', { name: 'README.md', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.vim-hint')).toHaveCount(0);
  await openFile(page, 'docs/sample.py');
  await expect(
    first.getByRole('tab', { name: 'docs/sample.py', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  const thirdControl = third.getByRole('button', {
    name: 'Focus editor group 3',
    exact: true,
  });
  const thirdHint = page.locator(
    `.vim-hint[data-hint-target="${await thirdControl.getAttribute('id')}"]`,
  );
  await page.keyboard.press('f');
  await expect(thirdHint).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(first).toHaveClass(/focused/);
  await page.keyboard.press('f');
  await page.keyboard.type((await thirdHint.textContent())!.toLowerCase());
  await expect(third).toHaveClass(/focused/);
  await expect(
    third.getByRole('tab', { name: 'README.md', exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: test.info().outputPath('editor-group-hints.png'),
  });
});

test('can jump between HTML and editor groups with f while preserving local HTML hints and text input', async ({
  page,
}) => {
  await openFile(page, 'README.md');
  await page
    .getByRole('button', { name: 'Split editor right', exact: true })
    .click();
  await openFile(page, 'docs/navigation.html');
  const frame = page.frameLocator('iframe[title="docs/navigation.html"]');
  const activate = frame.getByRole('button', { name: 'Activate', exact: true });
  await activate.focus();
  await page.keyboard.press('f');
  const control = editorGroup(page, 1).getByRole('button', {
    name: 'Focus editor group 1',
    exact: true,
  });
  const hint = page.locator(
    `.vim-hint[data-hint-target="${await control.getAttribute('id')}"]`,
  );
  await expect(hint).toBeVisible();
  await expect(frame.locator('.vim-hint')).toHaveCount(0);
  await page.keyboard.type((await hint.textContent())!.toLowerCase());
  await expect(editorGroup(page, 1)).toHaveClass(/focused/);
  await expect(
    editorGroup(page, 2).getByRole('tab', {
      name: 'docs/navigation.html',
      exact: true,
    }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('f');
  const frameHint = page.locator('.vim-hint[data-hint-target="IFRAME"]');
  await expect(frameHint).toBeVisible();
  await page.keyboard.type((await frameHint.textContent())!.toLowerCase());
  const localHint = frame.locator('.vim-hint[data-hint-target="activate"]');
  await expect(localHint).toBeVisible();
  await page.keyboard.type((await localHint.textContent())!.toLowerCase());
  await expect(frame.locator('body')).toHaveAttribute('data-clicked', 'yes');
  await expect(editorGroup(page, 2)).toHaveClass(/focused/);
  await frame.getByRole('textbox', { name: 'Text input', exact: true }).focus();
  await page.keyboard.type('f');
  await expect(
    frame.getByRole('textbox', { name: 'Text input', exact: true }),
  ).toHaveValue('f');
  await expect(page.locator('.vim-hint')).toHaveCount(0);
  await editorGroup(page, 1).getByRole('tab').click();
  await page.keyboard.press('f');
  await page.keyboard.type((await frameHint.textContent())!.toLowerCase());
  await expect(localHint).toBeVisible();
  await page.keyboard.type((await localHint.textContent())!.toLowerCase());
  await expect(frame.locator('.vim-hint')).toHaveCount(0);
  await editorGroup(page, 1)
    .getByRole('button', { name: 'Close README.md', exact: true })
    .click();
  await expect(page.locator('.editor-group')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Focus editor group 1', exact: true }),
  ).toBeHidden();
  await activate.focus();
  await page.keyboard.press('f');
  const singleGroupFrameHint = page.locator(
    '.vim-hint[data-hint-target="IFRAME"]',
  );
  await expect(singleGroupFrameHint).toBeVisible();
  await page.keyboard.type((await singleGroupFrameHint.textContent())!.toLowerCase());
  await expect(localHint).toBeVisible();
  await expect(page.locator('.vim-hint')).toHaveCount(0);
});

test('uses slash for fuzzy find and f hints to activate toolbar controls', async ({
  page,
}) => {
  // Run adjacent keys in one task to exercise the native dialog's queued close event.
  await page.evaluate(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'f',
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.getByRole('dialog')).toBeHidden();
  const find = page.locator('.vim-hint[data-hint-target="find-file"]');
  await expect(find).toBeVisible();
  await expect(
    page.locator('.vim-hint[data-hint-target="reload-file"]'),
  ).toHaveCount(0);
  await page.keyboard.type((await find.textContent())!.toLowerCase());
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect(page.locator('.vim-hint')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  await page.keyboard.press('Escape');
  await expect(page.locator('.vim-hint')).toHaveCount(0);
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await page.getByRole('searchbox').press('Escape');
  await openFile(page, 'README.md');
  await page.keyboard.press('f');
  const theme = page.locator('.vim-hint[data-hint-target="theme-toggle"]');
  await page.keyboard.type((await theme.textContent())!.toLowerCase());
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.vim-hint')).toHaveCount(0);
});

test('filters multi-letter hints, cancels them, and follows Markdown links', async ({
  page,
}) => {
  const content =
    '# Links\n\n' +
    Array.from(
      { length: 20 },
      (_, i) =>
        `[Link ${i}](docs/hello%20world%20%E6%97%A5%E6%9C%AC%E8%AA%9E.txt)`,
    ).join(' · ');
  await page.route('**/file?path=README.md&*', (route) =>
    route.fulfill({ contentType: 'text/plain', body: content }),
  );
  await openFile(page, 'README.md');
  await expect(
    page.getByRole('link', { name: 'Link 10', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    for (const [name, style, disabled] of [
      ['Hidden link', 'display:none', false],
      ['Offscreen link', 'position:fixed;top:-100px', false],
      ['Disabled button', '', true],
    ] as const) {
      const button = document.createElement('button');
      button.textContent = name;
      button.style.cssText = style;
      button.disabled = disabled;
      document.body.append(button);
    }
  });
  await page.keyboard.press('f');
  const labels = await page.locator('.vim-hint').allTextContents();
  expect(labels.length).toBeGreaterThan(9);
  expect(new Set(labels).size).toBe(labels.length);
  expect(labels.every((label) => label.length === 2)).toBe(true);
  await expect(
    page.locator(
      '.vim-hint[data-hint-target="Hidden link"], .vim-hint[data-hint-target="Offscreen link"], .vim-hint[data-hint-target="Disabled button"]',
    ),
  ).toHaveCount(0);
  const selected = page.locator('.vim-hint[data-hint-target="Link 10"]');
  const label = (await selected.textContent())!.toLowerCase();
  await page.keyboard.type(label[0]);
  expect(await page.locator('.vim-hint:visible').count()).toBeLessThan(
    labels.length,
  );
  await page.keyboard.press('Backspace');
  await expect(page.locator('.vim-hint:visible')).toHaveCount(labels.length);
  await page.keyboard.press('z');
  await expect(page.locator('.vim-hint')).toHaveCount(0);
  await page.keyboard.press('f');
  await page.screenshot({ path: test.info().outputPath('link-hints.png') });
  const popupPromise = page.waitForEvent('popup');
  await page.keyboard.type(label);
  const popup = await popupPromise;
  await expect(popup.locator('body')).toContainText('Hello, project!');
  await popup.close();
  await expect(page.locator('.vim-hint')).toHaveCount(0);
});

test('scrolls the active source using hjkl, G and gg while keeping the toolbar fixed', async ({
  page,
}) => {
  const content =
    '// ' + 'wide '.repeat(400) + '\n' + 'console.log("line");\n'.repeat(180);
  await page.route('**/file?path=docs%2Fsample.ts&*', (route) =>
    route.fulfill({ contentType: 'text/plain', body: content }),
  );
  await openFile(page, 'docs/sample.ts');
  await expect(page.locator('.source-text:visible')).toHaveAttribute(
    'data-language',
    'typescript',
  );
  const scroller = page.locator('.source-preview:visible');
  const toolbar = await page.locator('.preview-toolbar').boundingBox();
  await page.keyboard.press('j');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(64);
  await page.keyboard.press('k');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0);
  await page.keyboard.press('l');
  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBe(64);
  await page.keyboard.press('h');
  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBe(0);
  await page.keyboard.press('G');
  await expect
    .poll(() =>
      scroller.evaluate((el) =>
        Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop),
      ),
    )
    .toBeLessThanOrEqual(1);
  const bottom = await scroller.evaluate((el) => el.scrollTop);
  await page.keyboard.press('g');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(bottom);
  await page.keyboard.press('g');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0);
  expect(await page.locator('.preview-toolbar').boundingBox()).toEqual(toolbar);
  await page.keyboard.press('G');
  await page.keyboard.press('g');
  await page.keyboard.press('Escape');
  await page.keyboard.press('g');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(bottom);
  await page.keyboard.press('Escape');
  await page.keyboard.press('g');
  await page.waitForTimeout(850);
  await page.keyboard.press('g');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(bottom);
  await page.keyboard.press('/');
  await page.getByRole('searchbox').pressSequentially('hjklGggf/');
  await expect(page.getByRole('searchbox')).toHaveValue('hjklGggf/');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(bottom);
});

test('scrolls Markdown previews and clears hints when scrolling with the mouse', async ({
  page,
}) => {
  await page.route('**/file?path=README.md&*', (route) =>
    route.fulfill({
      contentType: 'text/plain',
      body: '# Long document\n\n' + 'Paragraph text.\n\n'.repeat(100),
    }),
  );
  await openFile(page, 'README.md');
  await expect(
    page.getByRole('heading', { name: 'Long document' }),
  ).toBeVisible();
  const scroller = page.locator('.viewer-surface:visible');
  await page.keyboard.press('j');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(64);
  await page.keyboard.press('G');
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(1000);
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0);
  await page.keyboard.press('f');
  await expect(page.locator('.vim-hint').first()).toBeVisible();
  await scroller.evaluate((el) => (el.scrollTop = 100));
  await expect(page.locator('.vim-hint')).toHaveCount(0);
});

test('supports hints, scrolling and slash search inside sandboxed HTML without intercepting text entry', async ({
  page,
}) => {
  await openFile(page, 'docs/navigation.html');
  const frame = page.frameLocator('iframe[title="docs/navigation.html"]');
  const button = frame.getByRole('button', { name: 'Activate', exact: true });
  await expect(
    page.getByRole('tab', { name: 'docs/navigation.html', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('j');
  await expect
    .poll(() => frame.locator('html').evaluate((el) => el.scrollTop))
    .toBe(64);
  await button.focus();
  await page.keyboard.press('f');
  const downloadHint = page.locator(
    '.vim-hint[data-hint-target="download-file"]',
  );
  await expect(downloadHint).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.type((await downloadHint.textContent())!.toLowerCase());
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('navigation.html');
  expect(await readFile(await download.path(), 'utf8')).toBe(
    '<!doctype html><html><body style="margin:0"><button id="activate" onclick="document.body.dataset.clicked=\'yes\'">Activate</button><input id="entry" aria-label="Text input"><div contenteditable="true" id="editable" aria-label="Editable text">Edit here</div><div style="height:2400px;width:1800px">Long and wide page</div></body></html>',
  );

  await button.focus();
  await page.keyboard.press('f');
  const frameHint = page.locator(
    '.vim-hint[data-hint-target="IFRAME"]',
  );
  await expect(frameHint).toBeVisible();
  await page.keyboard.type((await frameHint.textContent())!.toLowerCase());
  const hint = frame.locator('.vim-hint[data-hint-target="activate"]');
  await expect(hint).toBeVisible();
  await page.keyboard.type((await hint.textContent())!.toLowerCase());
  await expect(frame.locator('body')).toHaveAttribute('data-clicked', 'yes');
  await frame.getByRole('textbox', { name: 'Text input' }).focus();
  await page.keyboard.type('f/hjklGggr');
  await expect(frame.getByRole('textbox', { name: 'Text input' })).toHaveValue(
    'f/hjklGggr',
  );
  await expect(page.getByRole('dialog')).toBeHidden();
  await frame.locator('#editable').focus();
  await page.keyboard.type('f/hjklGgg');
  await expect(frame.locator('#editable')).toContainText('f/hjklGgg');
  await button.focus();
  await page.keyboard.press('j');
  await expect
    .poll(() => frame.locator('html').evaluate((el) => el.scrollTop))
    .toBe(64);
  await page.keyboard.press('l');
  await expect
    .poll(() => frame.locator('html').evaluate((el) => el.scrollLeft))
    .toBe(64);
  await page.keyboard.press('h');
  await expect
    .poll(() => frame.locator('html').evaluate((el) => el.scrollLeft))
    .toBe(0);
  await page.keyboard.press('G');
  await expect
    .poll(() => frame.locator('html').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(1000);
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await expect
    .poll(() => frame.locator('html').evaluate((el) => el.scrollTop))
    .toBe(0);
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(
    page.locator('iframe[title="docs/navigation.html"]'),
  ).toHaveAttribute('sandbox', 'allow-scripts');
});

test('ignores shortcut messages from other windows, inactive frames, and hidden HTML viewers', async ({
  page,
}) => {
  await openFile(page, 'docs/navigation.html');
  await expect(
    page
      .frameLocator('iframe[title="docs/navigation.html"]')
      .getByRole('button', { name: 'Activate', exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.postMessage({ type: 'fzv:shortcut', key: '/' }, '*'),
  );
  await expect(page.getByRole('dialog')).toBeHidden();
  const frame = page
    .frames()
    .find((frame) => frame.url().includes('navigation.html'))!;
  await openFile(page, 'README.md');
  await frame.evaluate(() =>
    parent.postMessage({ type: 'fzv:shortcut', key: '/' }, '*'),
  );
  await expect(page.getByRole('dialog')).toBeHidden();
  await page
    .getByRole('tab', { name: 'docs/navigation.html', exact: true })
    .click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await frame.evaluate(() =>
    parent.postMessage({ type: 'fzv:shortcut', key: '/' }, '*'),
  );
  await expect(page.getByRole('dialog')).toBeHidden();
});
