#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createViewer } from './server.js';
import { PRODUCT_NAME, VERSION } from '../shared.js';
import { viewerUrls } from './network.js';

const HELP = `${PRODUCT_NAME} — the file viewer for agent-driven development

Usage: ${PRODUCT_NAME} [--root PATH] [--host HOST] [--port PORT]

  --root PATH   Project directory (default: current working directory)
  --host HOST   Bind address (default: 127.0.0.1)
  --port PORT   HTTP port, 0 for a free port (default: 8000)
  -h, --help    Show this help
  -v, --version Show version

Find and preview PDF, HTML, images, and text. Files are read-only.
Use --host 0.0.0.0 explicitly to allow devices on your network.
`;

async function main(): Promise<void> {
  if (Number(process.versions.node.split('.')[0]) < 24)
    throw new Error('Node.js 24 or newer is required.');
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'string', default: '8000' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
    strict: true,
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
  if (!/^\d+$/.test(values.port!) || Number(values.port) > 65535)
    throw new Error('--port must be an integer between 0 and 65535.');
  const { server, catalog } = await createViewer({
    root: values.root ?? process.cwd(),
    host: values.host,
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(
      `${PRODUCT_NAME}: ${error.code === 'EADDRINUSE' ? `Port ${values.port} is in use. Choose another with --port.` : error.message}`,
    );
    process.exitCode = 1;
  });
  server.listen(Number(values.port), values.host, () => {
    const address = server.address();
    if (!address || typeof address === 'string') return;
    const urls = viewerUrls(values.host!, address.port);
    console.log(
      `\n  ${PRODUCT_NAME} ${VERSION}\n  Project  ${catalog.root}\n${urls.map((url) => `  Viewer   ${url}`).join('\n')}\n\n  Press Ctrl+C to stop.\n`,
    );
  });
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
