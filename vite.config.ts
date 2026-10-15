import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

// Keep runtime-loaded PDF resources local, with the filenames PDF.js expects.
// The development server uses the same finite asset list as the production build.
function pdfAssets(): Plugin {
  let building = false;
  const root = new URL('./node_modules/pdfjs-dist/', import.meta.url);
  const names = ['build/pdf.worker.mjs'];
  for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
    for (const name of readdirSync(new URL(`${directory}/`, root))) {
      if (name.startsWith('quickjs')) continue; // PDF scripting is disabled.
      names.push(`${directory}/${name}`);
    }
  }
  const assets = new Map(
    names.map((name) => [`/pdfjs/${name}`, fileURLToPath(new URL(name, root))]),
  );
  return {
    name: 'local-pdf-assets',
    configResolved(config) {
      building = config.command === 'build';
    },
    buildStart() {
      if (!building) return;
      for (const [url, filename] of assets)
        this.emitFile({
          type: 'asset',
          fileName: url.slice(1),
          source: readFileSync(filename),
        });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const filename = assets.get(req.url?.split('?')[0] ?? '');
        if (!filename) return next();
        const type =
          filename.endsWith('.mjs') || filename.endsWith('.js')
            ? 'text/javascript'
            : filename.endsWith('.wasm')
              ? 'application/wasm'
              : 'application/octet-stream';
        res.setHeader('Content-Type', type);
        res.end(readFileSync(filename));
      });
    },
  };
}

export default defineConfig({
  root: 'src/client',
  base: '/',
  plugins: [pdfAssets()],
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/file': 'http://127.0.0.1:8000',
      '/preview-html': 'http://127.0.0.1:8000',
      '/asset': 'http://127.0.0.1:8000',
    },
  },
});
