const runtimeGlobals = globalThis as typeof globalThis & {
  browser?: typeof browser;
  chrome?: typeof chrome;
};

export const extensionApi = runtimeGlobals.browser ?? runtimeGlobals.chrome;

if (!extensionApi?.runtime) {
  throw new Error('WebExtension runtime API is not available in this context.');
}
