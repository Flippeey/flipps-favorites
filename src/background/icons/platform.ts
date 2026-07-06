/**
 * Background-context platform detection and cross-origin fetch helpers.
 *
 * Kept in a separate module (no browser shim import) so callers like
 * icon-image.ts can import firefoxSafeFetch without pulling in the extension
 * API shim (browser.ts), which throws at module evaluation time in Node/Vitest
 * unless mocked.
 */

/**
 * Returns true when running on Firefox. Uses navigator.userAgent — the same
 * approach used in service-worker.ts (openBookmarkManager). Available on the
 * Firefox background page and the Chrome MV3 service worker.
 */
export function isFirefox(): boolean {
  return /firefox/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
}

/**
 * XHR-backed fetch shim for the Firefox background page.
 *
 * On Firefox MV3, declarativeNetRequest session rules do NOT apply
 * Access-Control-Allow-Origin to fetch() responses. However, host_permissions
 * DO grant XMLHttpRequest cross-origin access on the Firefox background page
 * (the documented design intent — see scripts/write-manifest.mjs, the
 * background.page comment). This function wraps XHR in a Promise that returns
 * a real Response object so callers are unchanged.
 *
 * Limitations acceptable for the icon pipeline:
 * - Always uses GET (all icon-pipeline callers use GET)
 * - cache directive from RequestInit is ignored (XHR uses browser cache)
 * - redirect follows are automatic (XHR default, matches fetch default)
 */
export function xhrFetch(url: string, init?: RequestInit, timeoutMs?: number): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.responseType = 'blob';
    if (timeoutMs !== undefined && timeoutMs > 0) {
      xhr.timeout = timeoutMs;
    }
    xhr.open('GET', url, true);

    // Forward request headers from init (e.g. Accept, X-Requested-With)
    const headers = init?.headers;
    if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
      const headerMap = headers as Record<string, string>;
      for (const [key, value] of Object.entries(headerMap)) {
        xhr.setRequestHeader(key, value);
      }
    }

    xhr.onload = () => {
      const blob = xhr.response as Blob ?? new Blob([]);
      const response = new Response(blob, { status: xhr.status });
      // Response.url isn't settable via the constructor — it's a read-only
      // property normally populated by the fetch machinery from the final
      // (post-redirect) URL. XHR auto-follows redirects and exposes the landed
      // URL via responseURL, so redefine the property to carry it through.
      // Callers (e.g. the origin-scrape cross-root-redirect guard in
      // icon-providers.ts) read response.url to detect a login/SSO redirect;
      // without this it's always '' on the XHR path and the guard never fires.
      Object.defineProperty(response, 'url', { value: xhr.responseURL || url, configurable: true });
      resolve(response);
    };

    xhr.onerror = () => {
      reject(new TypeError(`XHR network error fetching ${url}`));
    };

    xhr.ontimeout = () => {
      reject(new DOMException(`XHR timeout fetching ${url}`, 'TimeoutError'));
    };

    xhr.send();
  });
}

/**
 * Cross-origin fetch that works on both Chrome and Firefox MV3 backgrounds:
 *
 * - Chrome: uses fetch() — declarativeNetRequest session rules inject
 *   Access-Control-Allow-Origin so cross-origin fetches succeed.
 * - Firefox: uses XHR — host_permissions grant cross-origin access on the
 *   Firefox background page; declarativeNetRequest session rules do not apply
 *   to fetch() responses there.
 *
 * @param url       Target URL
 * @param init      Optional RequestInit (cache, headers, etc.)
 * @param timeoutMs Optional timeout in ms (applied to xhr.timeout on Firefox;
 *                  callers using fetchWithTimeout handle Chrome timeout via
 *                  AbortController separately)
 */
export async function firefoxSafeFetch(url: string, init?: RequestInit, timeoutMs?: number): Promise<Response> {
  if (isFirefox()) {
    return xhrFetch(url, init, timeoutMs);
  }
  return fetch(url, init);
}
