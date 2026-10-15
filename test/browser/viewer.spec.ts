import { test, expect } from '@playwright/test';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
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
  await page.goto(origin);
  await expect(
    page.getByRole('button', { name: 'README.md', exact: true }),
  ).toBeVisible();
});

test('finds files, navigates results by keyboard, and safely renders text', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(
    page.getByRole('heading', { name: 'Project files, in focus.' }),
  ).toBeVisible();
  await page.getByRole('searchbox').fill('hello 日本');
  await page.getByRole('searchbox').press('Enter');
  await expect(
    page.getByRole('tab', { name: 'docs/hello world 日本語.txt' }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.text-preview')).toContainText(
    '<unsafe> is plain text.',
  );
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
  await page.getByRole('button', { name: 'README.md', exact: true }).click();
  await page
    .getByRole('button', { name: 'docs/image.svg', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'docs/page.html', exact: true })
    .click();
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
test('loads HTML assets relative to the file and isolates scripts from the app', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'docs/page.html', exact: true })
    .click();
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
  await page.getByRole('button', { name: 'README.md', exact: true }).click();
  await page
    .getByRole('button', { name: 'docs/image.svg', exact: true })
    .click();
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
  await expect(page.locator('.text-preview')).toContainText('Example project');
  await page.getByRole('button', { name: 'Reload current file' }).click();
  await expect(page.locator('.text-preview')).toHaveText('# Changed on disk\n');
  await expect(page.getByRole('tab')).toHaveCount(2);
});
test('requests PDFs and supports search toggling and refreshing added files', async ({
  page,
}) => {
  const request = page.waitForResponse(
    (response) =>
      response.url().includes('/file?path=docs%2Fexample.pdf') &&
      response.request().method() === 'GET',
  );
  await page
    .getByRole('button', { name: 'docs/example.pdf', exact: true })
    .click();
  expect((await request).status()).toBe(200);
  await expect(page.locator('iframe[title="docs/example.pdf"]')).toBeVisible();
  await page.getByRole('button', { name: 'Toggle file search' }).click();
  await expect(page.getByRole('searchbox')).toBeHidden();
  await page.getByRole('tab', { name: 'docs/example.pdf' }).focus();
  await page.keyboard.press('f');
  await expect(page.getByRole('searchbox')).toBeFocused();
  await writeFile(path.join(fixture.root, 'new-note.md'), 'New file');
  await page.getByRole('button', { name: 'Refresh file list' }).click();
  await expect(
    page.getByRole('button', { name: 'new-note.md', exact: true }),
  ).toBeVisible();
});
test('remains usable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('searchbox')).toBeHidden();
  await page.getByRole('button', { name: 'Find a file', exact: false }).click();
  await page.getByRole('button', { name: 'README.md', exact: true }).click();
  await expect(page.getByRole('searchbox')).toBeHidden();
  await expect(page.locator('.text-preview')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('separates and restores project sessions when the same origin serves another root', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'README.md', exact: true }).click();
  await page
    .getByRole('button', { name: 'docs/image.svg', exact: true })
    .click();
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
    await page.getByRole('button', { name: 'image.svg', exact: true }).click();
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
