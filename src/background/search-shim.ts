/**
 * Web-search relay shim: dispatches a query to the browser's default search
 * engine from the background context.
 *
 * Chrome and Firefox expose DIFFERENT search APIs with DIFFERENT param
 * shapes (chrome.search.query({text, disposition}) vs.
 * browser.search.search({query})). Branch by isFirefox() the same way
 * icons/platform.ts branches fetch strategy, and accept the search API as an
 * injectable dependency (defaulting to the real global) so the call shape is
 * unit-testable without a real browser.
 *
 * Kept out of icons/ since this isn't icon-pipeline code, but follows the
 * same placement rule as icons/platform.ts: no extension-API import at
 * module evaluation time (globals are read lazily, inside the function body,
 * so importing this module doesn't throw in Node/Vitest).
 */

import { isFirefox } from './icons/platform';

export type SearchDisposition = 'CURRENT_TAB' | 'NEW_TAB' | 'NEW_WINDOW';

export interface ChromeSearchApi {
  query(queryInfo: { text: string; disposition: SearchDisposition }): Promise<void>;
}

export interface FirefoxSearchApi {
  search(searchProperties: { query: string; disposition: SearchDisposition }): Promise<void>;
}

export interface WebSearchDeps {
  chromeSearch?: ChromeSearchApi;
  firefoxSearch?: FirefoxSearchApi;
}

/**
 * Runs `query` against the browser's default search provider.
 *
 * `openInNewTab` mirrors the newtab-side openLinksInNewTab setting (threaded
 * through the message since the background context can't read it directly),
 * the same way bookmark/URL opens already branch on that setting.
 *
 * Chrome: chrome.search.query({ text, disposition }).
 * Firefox: browser.search.search({ query, disposition }) — disposition is
 * supported per MDN (CURRENT_TAB | NEW_TAB | NEW_WINDOW, mutually exclusive
 * with tabId).
 *
 * Failures are logged and rethrown (never swallowed) so the caller's
 * buildErrorEnvelope can surface an AppErrorResponse to the newtab UI.
 */
export async function performWebSearch(query: string, openInNewTab: boolean, deps: WebSearchDeps = {}): Promise<void> {
  const disposition: SearchDisposition = openInNewTab ? 'NEW_TAB' : 'CURRENT_TAB';
  try {
    if (isFirefox()) {
      const searchApi = deps.firefoxSearch
        ?? (globalThis as { browser?: { search?: FirefoxSearchApi } }).browser?.search;
      if (!searchApi) {
        throw new Error('browser.search API is unavailable.');
      }
      await searchApi.search({ query, disposition });
    } else {
      const searchApi = deps.chromeSearch
        ?? (globalThis as { chrome?: { search?: ChromeSearchApi } }).chrome?.search;
      if (!searchApi) {
        throw new Error('chrome.search API is unavailable.');
      }
      await searchApi.query({ text: query, disposition });
    }
  } catch (error) {
    console.error('Web search relay failed.', error);
    throw error;
  }
}
