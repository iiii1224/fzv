import { mkdtemp, mkdir, writeFile, open, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function createFixture() {
  const base = await mkdtemp(path.join(tmpdir(), 'fzv-test-'));
  const root = path.join(base, 'project');
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await mkdir(path.join(root, '.private'), { recursive: true });
  await mkdir(path.join(root, 'node_modules', 'dependency'), {
    recursive: true,
  });
  await mkdir(path.join(base, 'outside'), { recursive: true });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="280"><rect width="480" height="280" rx="20" fill="#e6d6c6"/><circle cx="240" cy="120" r="65" fill="#b65236"/><text x="240" y="228" text-anchor="middle" font-family="monospace" font-size="24" fill="#35322f">fzv preview</text></svg>';
  const pdfBody =
    '%PDF-1.4\n1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>>\nendobj\n4 0 obj\n<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>\nendobj\n5 0 obj\n<</Length 43>>\nstream\nBT /F1 22 Tf 30 100 Td (fzv preview) Tj ET\nendstream\nendobj\n';
  const offsets = [0];
  for (let i = 1; i <= 5; i++) offsets.push(pdfBody.indexOf(`${i} 0 obj`));
  const pdf =
    pdfBody +
    'xref\n0 6\n0000000000 65535 f \n' +
    offsets
      .slice(1)
      .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
      .join('') +
    `trailer\n<</Size 6 /Root 1 0 R>>\nstartxref\n${pdfBody.length}\n%%EOF\n`;
  await Promise.all([
    writeFile(path.join(root, 'empty.txt'), ''),
    writeFile(
      path.join(root, 'README.md'),
      '# Example project\n\nBuild with an agent. Browse with fzv.\n',
    ),
    writeFile(
      path.join(root, 'docs', 'hello world 日本語.txt'),
      'Hello, project!\n<unsafe> is plain text.\n',
    ),
    writeFile(path.join(root, 'docs', 'image.svg'), svg),
    writeFile(
      path.join(root, 'docs', 'style.css'),
      'body { background: rgb(245, 240, 232); color: rgb(53, 50, 47); font-family: sans-serif; }',
    ),
    writeFile(
      path.join(root, 'docs', 'page.html'),
      '<html><head><base href="https://example.invalid/"><link rel="stylesheet" href="style.css"></head><body><h1>Relative HTML preview</h1><img src="image.svg" width="240"><script>document.body.dataset.scriptRan="yes";try{localStorage.setItem("intrusion","yes")}catch{document.body.dataset.storageBlocked="yes"}try{parent.document.body.dataset.intrusion="yes"}catch{document.body.dataset.parentBlocked="yes"}</script></body></html>',
    ),
    writeFile(path.join(root, 'docs', 'example.pdf'), pdf),
    writeFile(path.join(root, '.env'), 'DO_NOT_SERVE=secret'),
    writeFile(path.join(root, '.private', 'secret.txt'), 'SECRET_HIDDEN'),
    writeFile(
      path.join(root, 'node_modules', 'dependency', 'index.js'),
      'SECRET_DEPENDENCY',
    ),
    writeFile(path.join(base, 'outside', 'secret.txt'), 'SECRET_OUTSIDE'),
    writeFile(path.join(root, 'x <script>.txt'), 'A safe filename.'),
  ]);
  const large = await open(path.join(root, 'too-large.txt'), 'w');
  await large.truncate(20 * 1024 * 1024 + 1);
  await large.close();
  if (process.platform !== 'win32')
    await Promise.all([
      symlink(
        path.join(base, 'outside', 'secret.txt'),
        path.join(root, 'escape.txt'),
      ),
      symlink(path.join(base, 'outside'), path.join(root, 'escape-dir'), 'dir'),
      symlink(
        path.join(root, '.private', 'secret.txt'),
        path.join(root, 'hidden-alias.txt'),
      ),
      symlink(path.join(root, 'README.md'), path.join(root, 'readme-alias.md')),
      symlink(
        path.join(root, 'docs', 'page.html'),
        path.join(root, 'disguised.txt'),
      ),
    ]);
  return {
    base,
    root,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}
