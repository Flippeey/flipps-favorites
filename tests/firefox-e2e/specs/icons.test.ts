// Guards: the Firefox XHR fetch path (firefoxSafeFetch / background page CORS,
// see .claude/architecture.md "Fetch Path: Chrome vs. Firefox") doesn't crash
// the icon resolution pipeline — an unreachable host must still resolve to the
// generated letter-tile SVG fallback instead of hanging or throwing.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import { launchFirefoxWithExtension, reloadAndWaitForApp, type FirefoxSession } from '../launch';
import { createBookmark, resetStorage, seedMinimal } from '../seed';
import { BOOKMARK_TILE } from '../selectors';

describe('icons', () => {
  let session: FirefoxSession;
  let page: Page;

  beforeAll(async () => {
    session = await launchFirefoxWithExtension();
    page = await session.newtabPage();
  });

  afterAll(async () => {
    await session.close();
  });

  beforeEach(async () => {
    await resetStorage(page);
  });

  it('a bookmark on an unreachable host resolves to a generated letter-tile fallback', async () => {
    const minimal = await seedMinimal(page, { rootBookmarks: 0 });
    await createBookmark(
      page,
      minimal.rootFolderId,
      'Unreachable Host',
      'https://this-host-does-not-exist.invalid/',
    );
    await reloadAndWaitForApp(page);

    await page.waitForSelector(BOOKMARK_TILE, { timeout: 10_000 });

    // Resolution is async (network probes + timeouts); poll until the pipeline
    // settles on the terminal <img> state. Per src/newtab/components/Favicon.tsx,
    // the <span> glyph is only a transient pre-resolution placeholder — Favicon
    // always ends in an <img>, even on total failure (fetchIcon's .catch sets
    // src to buildFallbackSvgDataUrl(...)). Requiring the terminal <img> here
    // (rather than accepting the transient glyph too) is what actually
    // exercises the Firefox XHR fallback pipeline this spec claims to guard —
    // an assertion that accepts either outcome can pass even if resolution
    // never completes.
    await page.waitForFunction(
      (sel: string) => {
        const img = document.querySelector(`${sel} .ff-favicon img`);
        return !!(img && img.getAttribute('src'));
      },
      { timeout: 20_000 },
      BOOKMARK_TILE,
    );

    const src = await page.$eval(`${BOOKMARK_TILE} .ff-favicon img`, (el) => el.getAttribute('src'));
    // The generated fallback is an inline SVG data URL — an unreachable host
    // has no real favicon to fetch, so this is the only valid outcome.
    expect(src).toContain('data:image/svg+xml');
  });
});
