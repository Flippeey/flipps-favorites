// Firefox-only regression guard: the context-menu "Open in new tab" /
// "Open N in new tabs" actions must open real tabs. Same root cause as the
// middle-click bug (see middle-click.test.ts) — Firefox's popup blocker
// silently drops `window.open(...)` unless it runs synchronously inside a
// trusted user-gesture handler. A React onClick handler that fires *after*
// the menu closes (state update -> re-render -> unmount) no longer counts as
// a fresh gesture on Firefox, so the old `window.open` loop in
// useContextMenuBuilder.ts (openInNewTabs) was silently blocked there even
// though Chrome tolerated it. The fix routes each URL through the message
// pipeline (openTab -> service worker extensionApi.tabs.create), mirroring
// the middle-click fix, so tabs open deterministically regardless of gesture
// timing.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Page, Target } from 'puppeteer';
import { launchFirefoxWithExtension, reloadAndWaitForApp, type FirefoxSession } from '../launch';
import { resetStorage, seedMinimal } from '../seed';
import { BOOKMARK_TILE, CONTEXT_MENU, CONTEXT_MENU_ITEM } from '../selectors';
import { clickByText } from '../wait';

/** Poll browser.targets() until at least `count` new, non-blank targets exist. */
async function waitForNewTargets(
  session: FirefoxSession,
  before: Set<Target>,
  count: number,
  timeoutMs = 5_000,
): Promise<Target[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const fresh = session.browser.targets().filter((t) => !before.has(t) && t.url() !== 'about:blank');
    if (fresh.length >= count) return fresh;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${count} new target(s); found ${fresh.length}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('context menu — open in new tab(s)', () => {
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

  it('"Open in new tab" on a single bookmark opens a new tab at its URL', async () => {
    await seedMinimal(page, { rootBookmarks: 1 });
    await reloadAndWaitForApp(page);
    await page.waitForSelector(BOOKMARK_TILE, { timeout: 10_000 });

    const bookmarkUrl = 'https://example.com/1';
    const targetsBefore = new Set(session.browser.targets());

    const tile = await page.$(BOOKMARK_TILE);
    if (!tile) throw new Error('context-menu spec: no bookmark tile found');
    await tile.click({ button: 'right' });
    await page.waitForSelector(CONTEXT_MENU, { timeout: 5_000 });
    await clickByText(page, `${CONTEXT_MENU} ${CONTEXT_MENU_ITEM}`, 'Open in new tab');

    const [newTarget] = await waitForNewTargets(session, targetsBefore, 1);
    expect(newTarget!.url()).toBe(bookmarkUrl);
  });

  it('"Open N in new tabs" on a multi-selection opens one tab per selected bookmark', async () => {
    // 3 root-level bookmarks; select 2 via Ctrl+Click (mirrors
    // useSelection.handleTileClick's metaKey/ctrlKey branch) so the context
    // menu's isInSelection path (>1 selected id) builds the "Open N" action
    // without needing folder navigation.
    await seedMinimal(page, { rootBookmarks: 3 });
    await reloadAndWaitForApp(page);
    await page.waitForSelector(BOOKMARK_TILE, { timeout: 10_000 });

    // Re-query tile handles fresh before each interaction rather than
    // reusing handles across clicks: React re-renders on every selection
    // change, and a stale ElementHandle from before that render throws
    // "no such node" over BiDi once the DOM node it pointed to is replaced.
    // Both selection clicks use Ctrl+Click (useSelection.handleTileClick's
    // metaKey/ctrlKey branch only ever toggles selection) — a *plain* click
    // would call handlePickBookmark, which with the default
    // openLinksInNewTab: false navigates the current page via
    // window.location.href and destroys every tile out from under the test.
    expect((await page.$$(BOOKMARK_TILE)).length).toBe(3);

    await page.keyboard.down('ControlLeft');
    await (await page.$$(BOOKMARK_TILE))[0]!.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await (await page.$$(BOOKMARK_TILE))[1]!.click();
    await page.keyboard.up('ControlLeft');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const expectedUrls = new Set(['https://example.com/1', 'https://example.com/2']);
    const targetsBefore = new Set(session.browser.targets());

    const tileForMenu = (await page.$$(BOOKMARK_TILE))[0]!;
    await tileForMenu.click({ button: 'right' });
    await page.waitForSelector(CONTEXT_MENU, { timeout: 5_000 });
    await clickByText(page, `${CONTEXT_MENU} ${CONTEXT_MENU_ITEM}`, 'Open 2 in new tabs');

    const newTargets = await waitForNewTargets(session, targetsBefore, 2);
    const openedUrls = new Set(newTargets.map((t) => t.url()));
    expect(openedUrls).toEqual(expectedUrls);
  });
});
