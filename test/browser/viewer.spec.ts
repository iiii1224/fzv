import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
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

async function openFile(page: Page, file: string): Promise<void> {
  if (!(await page.getByRole('searchbox').isVisible()))
    await page.keyboard.press('/');
  await page.getByRole('searchbox').fill(file);
  await page.getByRole('button', { name: file, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

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
  await expect(page.locator('iframe[title="docs/example.pdf"]')).toBeVisible();
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
  await button.focus();
  await page.keyboard.press('f');
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
