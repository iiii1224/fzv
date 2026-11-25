#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createViewer } from './server.js';
import { PRODUCT_NAME, VERSION } from '../shared.js';
import { projectPort, viewerUrls } from './network.js';
import {
  findOfficeConverter,
  OFFICE_CONVERTER_NAMES,
  which,
} from './office.js';

const HELP = `${PRODUCT_NAME} — the file viewer for agent-driven development

Usage: ${PRODUCT_NAME} [--root PATH] [--host HOST] [--port PORT] [--no-watch] [--allow-html-network] [--office-converter PATH]

  --root PATH   Project directory (default: current working directory)
  --host HOST   Bind address (default: 127.0.0.1)
  --port PORT   HTTP port, 0 for a free port (default: a port derived from
                the project path, or a free port if that one is unavailable)
  --watch       Watch for project file changes (default)
  --no-watch    Disable automatic file updates
  --allow-html-network  Allow HTML previews to run remote scripts and make network requests
  --office-converter PATH  ibisOffice or LibreOffice executable for Office previews
                (default: ibisOffice, then soffice/libreoffice, found on PATH)
  -h, --help    Show this help
  -v, --version Show version

Find and preview PDF, HTML, images, text, and Office documents
(.docx, .xlsx, .pptx, converted to PDF). Files are read-only.
Use --host 0.0.0.0 explicitly to allow devices on your network.
`;

async function main(): Promise<void> {
  if (Number(process.versions.node.split('.')[0]) < 24)
    throw new Error('Node.js 24 or newer is required.');
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'string' },
      watch: { type: 'boolean' },
      'allow-html-network': { type: 'boolean', default: false },
      'office-converter': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
    strict: true,
    allowNegative: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (values.version) {
    console.log(VERSION);
    return;
  }
  if (
    values.port !== undefined &&
    (!/^\d+$/.test(values.port) || Number(values.port) > 65535)
  )
    throw new Error('--port must be an integer between 0 and 65535.');
  const officeConverter = await findOfficeConverter(values['office-converter']);
  const git = (await which('git', process.env)) ?? null;
  const { server, catalog } = await createViewer({
    root: values.root ?? process.cwd(),
    host: values.host,
    watch: values.watch,
    allowHtmlNetwork: values['allow-html-network'],
    officeConverter,
    git,
  });
  server.on('watchError', (error: Error) => {
    console.error(`${PRODUCT_NAME}: file watching stopped: ${error.message}`);
  });
  if (values['allow-html-network'])
    console.warn(
      `${PRODUCT_NAME}: HTML previews can run network-loaded code. Use only with trusted projects.`,
    );
  let port =
    values.port === undefined
      ? projectPort(catalog.project.id)
      : Number(values.port);
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (
      values.port === undefined &&
      !server.listening &&
      port !== 0 &&
      (error.code === 'EADDRINUSE' || error.code === 'EACCES')
    ) {
      console.warn(
        `${PRODUCT_NAME}: Port ${port} is ${error.code === 'EADDRINUSE' ? 'in use' : 'unavailable'}; using a free port.`,
      );
      port = 0;
      server.listen(port, values.host);
      return;
    }
    console.error(
      `${PRODUCT_NAME}: ${error.code === 'EADDRINUSE' ? `Port ${port} is in use. Choose another with --port.` : error.message}`,
    );
    process.exitCode = 1;
  });
  server.once('listening', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return;
    const urls = viewerUrls(values.host!, address.port);
    const office = officeConverter
      ? `${OFFICE_CONVERTER_NAMES[officeConverter.kind]} (${officeConverter.command})`
      : 'unavailable; install ibisOffice or LibreOffice';
    console.log(
      `\n  ${PRODUCT_NAME} ${VERSION}\n  Project  ${catalog.root}\n${urls.map((url) => `  Viewer   ${url}`).join('\n')}\n  Office   ${office}\n  Git      ${git ?? 'unavailable; install git for Source Control'}\n\n  Press Ctrl+C to stop.\n`,
    );
  });
  server.listen(port, values.host);
  const stop = () => {
    server.close();
    server.closeAllConnections();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
main().catch((error: unknown) => {
  console.error(
    `${PRODUCT_NAME}: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
