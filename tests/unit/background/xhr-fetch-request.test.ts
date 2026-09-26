import { afterEach, describe, expect, it, vi } from 'vitest';
import { firefoxSafeFetchRequest, ResponseTooLargeError, xhrFetchRequest } from '@/background/icons/platform';

// Minimal XMLHttpRequest stand-in: completes on send() with the configured
// status and an ArrayBuffer response, as Firefox does for responseType
// 'arraybuffer' (an empty buffer, never null, even for a bodiless 204).
let lastXhr: { aborted: boolean } | null = null;

function stubXhr(status: number, body: ArrayBuffer): void {
  class FakeXhr {
    responseType = '';
    timeout = 0;
    status = 0;
    statusText = '';
    response: ArrayBuffer | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onprogress: ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null = null;
    aborted = false;
    open(): void {}
    setRequestHeader(): void {}
    abort(): void {
      this.aborted = true;
      lastXhr = this;
    }
    send(): void {
      this.status = status;
      this.response = body;
      queueMicrotask(() => {
        this.onprogress?.({ loaded: body.byteLength, total: body.byteLength, lengthComputable: true });
        if (!this.aborted) this.onload?.();
      });
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
}

describe('xhrFetchRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The sync server answers a successful PUT with 204 No Content. Wrapping the
  // XHR's empty ArrayBuffer in a Response with a null-body status throws inside
  // onload, so the promise never settles and a Firefox push never completes.
  it.each([204, 205, 304])('resolves a bodiless %i response instead of hanging', async (status) => {
    stubXhr(status, new ArrayBuffer(0));
    const response = await xhrFetchRequest('https://api.flippflix.com/sync', { method: 'PUT' });
    expect(response.status).toBe(status);
  });

  it('keeps the body bytes of a 200 response', async () => {
    stubXhr(200, new Uint8Array([1, 2, 3]).buffer);
    const response = await xhrFetchRequest('https://api.flippflix.com/sync', { method: 'GET' });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('sync response size cap', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    lastXhr = null;
  });

  // An oversized sync response must be dropped mid-download, not buffered
  // whole in the background page.
  it('aborts a Firefox download that grows past the cap', async () => {
    stubXhr(200, new ArrayBuffer(10));
    await expect(xhrFetchRequest('https://api.flippflix.com/sync', { method: 'GET' }, undefined, 8))
      .rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(lastXhr?.aborted).toBe(true);
  });

  it('rejects a Chrome response whose declared length exceeds the cap without reading it', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Length': '100' } }));
    await expect(firefoxSafeFetchRequest('https://api.flippflix.com/sync', { method: 'GET' }, undefined, 8))
      .rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it('stops reading a Chrome response once the received bytes pass the cap', async () => {
    let pulled = 0;
    const chunks = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 4) controller.close();
        else controller.enqueue(new Uint8Array(5));
      },
    });
    vi.stubGlobal('fetch', async () => new Response(chunks, { status: 200 }));
    await expect(firefoxSafeFetchRequest('https://api.flippflix.com/sync', { method: 'GET' }, undefined, 8))
      .rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(pulled).toBeLessThan(4);
  });

  it('returns a Chrome body within the cap intact', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const response = await firefoxSafeFetchRequest('https://api.flippflix.com/sync', { method: 'GET' }, undefined, 8);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('Chrome sync request timeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A stalled sync server must not leave Sync now spinning forever.
  it('aborts a request that outlives its timeout', async () => {
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));
    await expect(firefoxSafeFetchRequest('https://api.flippflix.com/sync', { method: 'GET' }, 20))
      .rejects.toMatchObject({ name: 'TimeoutError' });
  }, 1_000);
});
