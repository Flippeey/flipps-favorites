import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('../..', import.meta.url));

// Firefox Puppeteer smoke suite. Separate config + separate `vitest run -c`
// invocation so it is NOT picked up by `npm run test:unit`
// (root vitest.config.ts include is `tests/unit/**/*.test.ts` only).
export default defineConfig({
  resolve: {
    alias: { '@': resolve(rootDir, 'src') },
  },
  test: {
    include: ['tests/firefox-e2e/specs/**/*.test.ts'],
    environment: 'node',
    // One Firefox instance at a time — launching Firefox is heavy and the
    // suite is a smoke suite, not a throughput target. Raise later if stable.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
