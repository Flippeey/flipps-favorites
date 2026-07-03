// Firefox-only regression guard: middle-clicking a bookmark tile must open
// the bookmark's URL in a new tab (see CLAUDE.md / plan Phase 2). Root cause
// of the original bug was `window.open(...)` called from an `auxclick`
// handler on a non-anchor element — Firefox's popup blocker silently drops
// that call (Chrome permits it). The fix routes the open through the message
// pipeline (`openTab` -> service worker `extensionApi.tabs.create`, see
// openInNewTab in src/newtab/App.tsx), so a real tab target now appears
// deterministically — no user gesture required, since it's a genuine
// WebExtension API call, not a window.open() heuristic.
//
// This spec cannot use real mouse synthesis: the Phase 0 spike proved BiDi's
// synthesized `page.mouse.click(x, y, { button: 'middle' })` never triggers
// Firefox's native tab-spawning gesture at all. Instead it tests app
// *intent*: dispatch the exact DOM event BookmarkTile listens for
// (`auxclick`, e.button === 1, see src/newtab/components/Tile.tsx) and
// assert a new tab lands at the bookmark's URL.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import { launchFirefoxWithExtension, reloadAndWaitForApp, type FirefoxSession } from '../launch';
import { resetStorage, seedMinimal } from '../seed';
import { BOOKMARK_TILE } from '../selectors';

describe('middle-click', () => {
  let session: FirefoxSession;
  let page: Page;

  beforeAll(async () => {
    session = await launchFirefoxWithExtension();
    page = await session.newtabPage();
  });

  afterAll(async () => {
    await session.close();
  });

  let bookmarkUrl: string;

  beforeEach(async () => {
    await resetStorage(page);
    // seedMinimal points root bookmarks at `https://example.com/<n>` in
    // creation order (see tests/firefox-e2e/seed.ts). rootBookmarks: 1 seeds
    // exactly one, so its URL is deterministic without hardcoding a value
    // that could silently drift from the seed helper's own URL scheme.
    await seedMinimal(page, { rootBookmarks: 1 });
    bookmarkUrl = 'https://example.com/1';
    await reloadAndWaitForApp(page);
  });

  it('dispatching a middle-click auxclick on a bookmark tile opens a new tab at the bookmark URL', async () => {
    await page.waitForSelector(BOOKMARK_TILE, { timeout: 10_000 });

    const targetsBefore = new Set(session.browser.targets());

    await page.evaluate((sel: string) => {
      const tile = document.querySelector(sel);
      if (!tile) throw new Error(`middle-click spec: no tile matching ${sel}`);
      tile.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));
    }, BOOKMARK_TILE);

    // Poll for a new target rather than a fixed sleep: the open goes through
    // an async message round-trip (newtab -> service worker -> tabs.create).
    const deadline = Date.now() + 5_000;
    let newTarget = null;
    while (Date.now() < deadline && !newTarget) {
      newTarget = session.browser.targets().find((t) => !targetsBefore.has(t) && t.url() !== 'about:blank') ?? null;
      if (!newTarget) await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(newTarget).not.toBeNull();
    expect(newTarget!.url()).toBe(bookmarkUrl);
  });
});
