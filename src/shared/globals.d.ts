// `chrome` global is supplied by @types/chrome (scoped via tsconfig "types").
// Firefox exposes the same surface under `browser`; type it as chrome's shape.
// `extensionApi` (shared/browser.ts) picks whichever exists at runtime.
declare const browser: typeof chrome | undefined;
