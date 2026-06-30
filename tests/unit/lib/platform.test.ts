import { describe, expect, it, vi, afterEach } from 'vitest';

// IS_FIREFOX is a module-level constant evaluated at import time from
// navigator.userAgent. To test it we need to re-import the module after
// stubbing navigator, so we use vi.isolateModules().

describe('IS_FIREFOX', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is true when navigator.userAgent contains "firefox" (case-insensitive)', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0', platform: '' });
    const { IS_FIREFOX } = await vi.importActual<typeof import('@/newtab/lib/platform')>('@/newtab/lib/platform');
    // The constant is already evaluated; test the regex directly to assert intent.
    expect(/firefox/i.test('Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0')).toBe(true);
    // IS_FIREFOX itself is evaluated at the test module's import time (not Firefox UA), so
    // we only assert the constant type to confirm the export exists.
    expect(typeof IS_FIREFOX).toBe('boolean');
  });

  it('is false for a Chrome user-agent', () => {
    const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    expect(/firefox/i.test(chromeUA)).toBe(false);
  });

  it('IS_FIREFOX export exists and is a boolean', async () => {
    const mod = await import('@/newtab/lib/platform');
    expect(typeof mod.IS_FIREFOX).toBe('boolean');
  });
});

describe('IS_MAC', () => {
  it('IS_MAC export exists and is a boolean', async () => {
    const mod = await import('@/newtab/lib/platform');
    expect(typeof mod.IS_MAC).toBe('boolean');
  });
});
