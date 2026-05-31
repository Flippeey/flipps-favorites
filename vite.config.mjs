import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(rootDir, 'src') },
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
});
