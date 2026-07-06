// `chrome` global is supplied by @types/chrome (scoped via tsconfig "types").
// Firefox exposes the same surface under `browser`; type it as chrome's shape.
// `extensionApi` (shared/browser.ts) picks whichever exists at runtime.
declare const browser: typeof chrome | undefined;

// Vite `define` compile-time constant (vite.config.mjs). FALSE in every
// non-test build — see storage-buckets.ts for the gated branch and
// vite.config.mjs for how the literal is injected.
declare const __FF_TEST_STORAGE_LOCAL__: boolean;
