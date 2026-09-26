import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// browser.ts throws unless a WebExtension runtime is present. Stub it.
vi.mock('@/shared/browser', () => ({
  extensionApi: {
    runtime: {},
    declarativeNetRequest: undefined,
  },
}));

import { isFirefox, firefoxSafeFetch } from '@/background/icons/cors-bypass';

// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------------
// Firefox MV3 background pages do NOT apply declarativeNetRequest session rules
// to fetch() responses. Host_permissions grant XHR (XMLHttpRequest) cross-origin
// access on the Firefox background page, which is the documented design intent
// (see scripts/write-manifest.mjs comment at the `background.page` entry).
//
// These tests pin the branching logic: Chrome uses fetch(), Firefox uses XHR.
// They also verify that the XHR path produces a Response-compatible value so
// the rest of the pipeline (fetchAndValidateImage, blob(), text(), etc.) works
// unchanged on both targets.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// isFirefox() — must agree with navigator.userAgent
// ---------------------------------------------------------------------------

describe('isFirefox()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when userAgent contains Firefox', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
    });
    expect(isFirefox()).toBe(true);
  });

  it('returns false for a Chrome userAgent', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0',
    });
    expect(isFirefox()).toBe(false);
  });

  it('returns false when userAgent is empty', () => {
    vi.stubGlobal('navigator', { userAgent: '' });
    expect(isFirefox()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// firefoxSafeFetch() — routes to fetch() on Chrome, XHR on Firefox
// ---------------------------------------------------------------------------

describe('firefoxSafeFetch() on Chrome (fetch path)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    // Simulate Chrome UA
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 Chrome/125.0',
    });
  });

  it('delegates to the global fetch on Chrome', async () => {
    const mockResponse = new Response('ok', { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', fetchMock);

    const result = await firefoxSafeFetch('https://example.com/icon.png');
    expect(fetchMock).toHaveBeenCalledOnce();
    // The first argument must be the URL; init is passed as-is (undefined when omitted)
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/icon.png');
    expect(result).toBe(mockResponse);
  });

  it('passes RequestInit options through to fetch on Chrome', async () => {
    const mockResponse = new Response('', { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', fetchMock);

    await firefoxSafeFetch('https://example.com/icon.png', { cache: 'force-cache' });
    const callInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(callInit.cache).toBe('force-cache');
  });
});

describe('firefoxSafeFetch() on Firefox (XHR path)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    // Simulate Firefox UA
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
    });
  });

  it('does NOT call global fetch on Firefox', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // Provide a minimal XHR stub
    const xhrInstance = makeXhrStub({ status: 200, responseBlob: new Blob(['icon'], { type: 'image/png' }) });
    vi.stubGlobal('XMLHttpRequest', vi.fn(mockXhrCtor(xhrInstance)));

    await firefoxSafeFetch('https://example.com/icon.png');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a Response with the correct status on success', async () => {
    const blob = new Blob(['<svg/>'], { type: 'image/svg+xml' });
    const xhrInstance = makeXhrStub({ status: 200, responseBlob: blob });
    vi.stubGlobal('XMLHttpRequest', vi.fn(mockXhrCtor(xhrInstance)));

    const response = await firefoxSafeFetch('https://example.com/icon.svg');
    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    const resultBlob = await response.blob();
    expect(resultBlob.type).toBe('image/svg+xml');
  });

  it('returns a non-ok Response when XHR status is 404', async () => {
    const xhrInstance = makeXhrStub({ status: 404, responseBlob: new Blob([]) });
    vi.stubGlobal('XMLHttpRequest', vi.fn(mockXhrCtor(xhrInstance)));

    const response = await firefoxSafeFetch('https://example.com/missing.png');
    expect(response.status).toBe(404);
    expect(response.ok).toBe(false);
  });

  it('rejects when XHR encounters a network error', async () => {
    const xhrInstance = makeXhrStub({ networkError: true });
    vi.stubGlobal('XMLHttpRequest', vi.fn(mockXhrCtor(xhrInstance)));

    await expect(firefoxSafeFetch('https://unreachable.test/icon.png'))
      .rejects.toThrow();
  });

  it('sets XHR responseType to blob', async () => {
    const xhrInstance = makeXhrStub({ status: 200, responseBlob: new Blob(['x']) });
    vi.stubGlobal('XMLHttpRequest', vi.fn(mockXhrCtor(xhrInstance)));

    await firefoxSafeFetch('https://example.com/icon.png');
    expect(xhrInstance.responseType).toBe('blob');
  });

  it('opens the request as GET with the correct URL', async () => {
    const xhrInstance = makeXhrStub({ status: 200, responseBlob: new Blob(['x']) });
    vi.stubGlobal('XMLHttpRequest', vi.fn(mockXhrCtor(xhrInstance)));

    await firefoxSafeFetch('https://example.com/test.png');
    expect(xhrInstance.openArgs).toEqual(['GET', 'https://example.com/test.png', true]);
  });

  it('applies timeout when timeoutMs is provided', async () => {
    const xhrInstance = makeXhrStub({ status: 200, responseBlob: new Blob(['x']) });
    vi.stubGlobal('XMLHttpRequest', vi.fn(mockXhrCtor(xhrInstance)));

    await firefoxSafeFetch('https://example.com/icon.png', undefined, 3000);
    expect(xhrInstance.timeout).toBe(3000);
  });

  it('rejects when XHR times out', async () => {
    const xhrInstance = makeXhrStub({ timeout: true });
    vi.stubGlobal('XMLHttpRequest', vi.fn(mockXhrCtor(xhrInstance)));

    await expect(firefoxSafeFetch('https://slow.test/icon.png', undefined, 100))
      .rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// XHR stub factory
// ---------------------------------------------------------------------------

interface XhrStubOptions {
  status?: number;
  responseBlob?: Blob;
  networkError?: boolean;
  timeout?: boolean;
}

interface XhrStub {
  responseType: XMLHttpRequestResponseType;
  timeout: number;
  response: unknown;
  status: number;
  openArgs: unknown[];
  open: (method: string, url: string, async: boolean) => void;
  send: () => void;
  setRequestHeader: (key: string, value: string) => void;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  ontimeout: (() => void) | null;
}

function makeXhrStub(opts: XhrStubOptions): XhrStub {
  const stub: XhrStub = {
    responseType: '' as XMLHttpRequestResponseType,
    timeout: 0,
    response: opts.responseBlob ?? null,
    status: opts.status ?? 0,
    openArgs: [],
    onload: null,
    onerror: null,
    ontimeout: null,
    open(method: string, url: string, async: boolean) {
      stub.openArgs = [method, url, async];
    },
    send() {
      // Fire the appropriate callback asynchronously (microtask), so the
      // awaiting promise resolves before the test assertions run.
      Promise.resolve().then(() => {
        if (opts.networkError) {
          stub.onerror?.();
        } else if (opts.timeout) {
          stub.ontimeout?.();
        } else {
          stub.onload?.();
        }
      });
    },
    setRequestHeader() { /* no-op */ },
  };
  return stub;
}

// vitest 4 invokes stubbed constructors with `new`, so the mock implementation
// must be a real (non-arrow) function — an arrow throws "is not a constructor".
// Returning the stub from the body makes `new XMLHttpRequest()` yield it.
function mockXhrCtor(instance: XhrStub): () => XhrStub {
  return function () {
    return instance;
  };
}
