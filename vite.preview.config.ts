import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Browser preview of the renderer with sample data, for design work and UI
 * tests: `npx vite --config vite.preview.config.ts`, then open /preview.html.
 *
 * The owner's crest is private and git-ignored; the preview shows it only when
 * it exists on this machine, and the plain shield otherwise.
 */
const crest = ['crest.png', 'crest.webp']
  .map((f) => resolve(__dirname, 'data', 'brand', f))
  .find((p) => existsSync(p));

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: { alias: { '@shared': resolve(__dirname, 'shared') } },
  define: {
    __PREVIEW_CREST__: JSON.stringify(crest ? `/@fs/${crest.replace(/\\/g, '/')}` : null),
  },
  server: {
    port: 5199,
    strictPort: true,
    open: false,
    fs: { allow: [resolve(__dirname)] },
  },
});
