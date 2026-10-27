// Emulates `ibisOffice --export pdf --out-dir DIR FILE` for tests.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createPdf } from './fixtures.mjs';

const args = process.argv.slice(2);
const outDir = args[args.indexOf('--out-dir') + 1];
const input = args.at(-1);
const text = readFileSync(input, 'utf8').trim();
if (process.env.FZV_FAKE_OFFICE_LOG)
  appendFileSync(process.env.FZV_FAKE_OFFICE_LOG, `${input}\n`);
if (text.startsWith('FAIL')) {
  console.error(`ibisOffice: ${input}: not a valid Office document`);
  process.exit(1);
}
writeFileSync(
  path.join(outDir, `${path.basename(input, path.extname(input))}.pdf`),
  createPdf(2, text),
);
