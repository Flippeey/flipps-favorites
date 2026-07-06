import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(rootDir, 'src') },
  },
  // Compile-time-only switch that forces the storage seam (storage-buckets.ts)
  // onto chrome.storage.local under test, skipping the async sync-preferred
  // flush race that causes intermittent "persists after reload" Playwright
  // flakes (see playwright.config.ts). FALSE for every mode except the
  // dedicated `chrome-test` mode (npm run build:chrome:test, output:
  // dist/chrome-test), so `npm run build` / `build:chrome` / `build:firefox`
  // (the release path, output: dist/chrome + dist/firefox) are byte-unaffected
  // — the literal `false` lets Rollup dead-code-eliminate every gated branch.
  // Only tests/fixtures/launch.ts's launchChrome() consumes dist/chrome-test.
  define: {
    __FF_TEST_STORAGE_LOCAL__: JSON.stringify(mode === 'chrome-test'),
  },
  build: {
    target: 'es2022',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        newtab: resolve(rootDir, 'newtab.html'),
        background: resolve(rootDir, 'src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: chunkInfo => {
          if (chunkInfo.name === 'background') {
            return 'background.js';
          }
          return 'assets/[name].js';
        },
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
}));
