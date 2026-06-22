/**
 * Icon Horse placeholder gate: verifies that monotone letter-placeholders from
 * Icon Horse are rejected by the pipeline, falling through to DDG or generated.
 * Also verifies real Icon Horse favicons still resolve via Icon Horse (no regression).
 *
 * WHY: Icon Horse returns letter-tile placeholders (grey bg + grey letter) for
 * hosts without a real favicon. These passed all prior quality checks and poisoned
 * the cache, preventing DDG from finding the real brand logo. The compound gate
 * (few colors + dominant achromatic grey) rejects them surgically.
 */
import { test, expect } from '../fixtures/extension-context.js';

// Helper: resolve an icon through the extension's message pipeline and return sourceKind.
// Uses runtime.sendMessage to hit the real resolveAutomaticIcon code path.
async function resolveIconSourceKind(
  page: import('@playwright/test').Page,
  bookmarkUrl: string,
  bookmarkTitle?: string,
): Promise<string | undefined> {
  return page.evaluate(async (args: { url: string; title?: string }) => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    const result = await api.runtime.sendMessage({
      type: 'icons/get',
      bookmarkUrl: args.url,
      bookmarkTitle: args.title,
    });
    // Service worker returns { icon: ResolvedIcon }
    return (result?.icon?.sourceKind ?? result?.sourceKind) as string | undefined;
  }, { url: bookmarkUrl, title: bookmarkTitle });
}

// Helper: invalidate an icon's cache to force fresh resolution.
async function invalidateIcon(page: import('@playwright/test').Page, bookmarkUrl: string): Promise<void> {
  await page.evaluate(async (url: string) => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    await api.runtime.sendMessage({ type: 'icons/invalidate', bookmarkUrl: url });
  }, bookmarkUrl);
}

test.describe('Icon Horse placeholder gate', () => {
  // WHY: dela.nl and phidec.twinq.nl get IH letter-placeholders (grey squares).
  // With the gate, the pipeline should reject IH and fall through to DDG ('search')
  // or, if DDG finds nothing, the clean generated letter-tile ('generated').
  // The key assertion: sourceKind must NOT be 'iconhorse'.
  test('placeholder hosts do not resolve via iconhorse', async ({ context, newtabPage }) => {
    // Block origin scrape + Google S2 to isolate the IH -> DDG path.
    await context.route('https://dela.nl/**', route => route.abort('failed'));
    await context.route('https://phidec.twinq.nl/**', route => route.abort('failed'));
    await context.route('https://www.google.com/s2/favicons**', route => route.abort('failed'));

    for (const [url, title] of [
      ['https://dela.nl', 'Dela'],
      ['https://phidec.twinq.nl', 'Phidec'],
    ] as const) {
      await invalidateIcon(newtabPage, url);
      const sourceKind = await resolveIconSourceKind(newtabPage, url, title);
      console.log(`  ${url}: sourceKind=${sourceKind ?? 'undefined'}`);
      expect(
        sourceKind,
        `${url} must NOT resolve via iconhorse (got ${sourceKind ?? 'undefined'})`,
      ).not.toBe('iconhorse');
    }
  });

  // WHY: github.com has a real favicon on Icon Horse (the Octocat, not a placeholder).
  // After the gate, it must STILL resolve via iconhorse -- no latency regression.
  test('control: github.com still resolves via iconhorse', async ({ context, newtabPage }) => {
    // Block origin scrape + S2 so only IH and DDG are available.
    await context.route('https://github.com/**', route => route.abort('failed'));
    await context.route('https://www.google.com/s2/favicons**', route => route.abort('failed'));

    await invalidateIcon(newtabPage, 'https://github.com');
    const sourceKind = await resolveIconSourceKind(newtabPage, 'https://github.com', 'GitHub');
    console.log(`  github.com: sourceKind=${sourceKind ?? 'undefined'}`);
    expect(
      sourceKind,
      'github.com must still resolve via iconhorse (control)',
    ).toBe('iconhorse');
  });
});
