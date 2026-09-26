import { afterEach, describe, expect, it, vi } from 'vitest';
import { xhrFetchRequest } from '@/background/icons/platform';

// Minimal XMLHttpRequest stand-in: completes on send() with the configured
// status and an ArrayBuffer response, as Firefox does for responseType
// 'arraybuffer' (an empty buffer, never null, even for a bodiless 204).
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
    open(): void {}
    setRequestHeader(): void {}
    send(): void {
      this.status = status;
      this.response = body;
      queueMicrotask(() => this.onload?.());
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
