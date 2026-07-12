import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

// Unit tests only — Playwright owns tests/specs/**.
export default defineConfig({
  resolve: {
    alias: { '@': resolve(rootDir, 'src') },
  },
  // Mirrors vite.config.mjs's compile-time constant so storage-buckets.ts's
  // gated branch resolves under Vitest too (always false here — unit tests
  // exercise the same default as production).
  define: {
    __FF_TEST_STORAGE_LOCAL__: JSON.stringify(false),
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
