import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  base: '/',
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
