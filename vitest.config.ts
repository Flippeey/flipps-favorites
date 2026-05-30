import { defineConfig } from 'vitest/config';

// Unit tests only — Playwright owns tests/specs/**.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
