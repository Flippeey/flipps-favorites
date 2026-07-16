/**
 * Hero search — typing shows results, keyboard focus shortcuts, folder/bookmark
 * activation from results, empty state, and relevance-ranked ordering.
 *
 * WHY these tests matter:
 *   - Search is the fastest navigation path; it must surface the right items.
 *   - Keyboard shortcuts (Ctrl+K, /) let power users reach search without a mouse.
 *   - Enter on a folder result should open it (not navigate away).
 *   - Enter on a bookmark should open the URL.
 *   - "No matches" tells the user their query matched nothing — prevents confusion
 *     over a silently empty dropdown.
 *   - Title matches outranking URL matches means the most recognisable result
 *     surfaces first.
 */
import { test, expect } from '../fixtures/world.js';

// ── Locator helpers (HeroSearch DOM contract) ─────────────────────────────────

/** The search text input (aria-label on the <input> inside .ff-search-wrap). */
function searchInput(page: import('@playwright/test').Page) {
  return page.locator('input[aria-label="Search bookmarks"]');
}

/** The results listbox that appears while the input is focused and has a value. */
function resultsBox(page: import('@playwright/test').Page) {
  return page.locator('#ff-search-results');
}

/** All result items inside the open results box. */
function resultItems(page: import('@playwright/test').Page) {
  return page.locator('#ff-search-results .ff-results__item');
}

/** The single web-search / open-URL fallback row shown when there are zero bookmark matches. */
function fallbackRow(page: import('@playwright/test').Page) {
  return page.locator('.ff-search-fallback');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Replace chrome.runtime.sendMessage with a spy that intercepts
 * 'search/web-query' messages (recording the query, short-circuiting the real
 * background dispatch so no live browser search tab opens) and passes every
 * other message type through untouched.
 */
async function spyOnWebSearch(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const api = (globalThis as any).browser ?? (globalThis as any).chrome;
    const original = api.runtime.sendMessage.bind(api.runtime);
    (globalThis as any).__ffWebSearchCalls = [];
    api.runtime.sendMessage = (msg: any, ...rest: any[]) => {
      if (msg && msg.type === 'search/web-query') {
        (globalThis as any).__ffWebSearchCalls.push(msg.query);
        return Promise.resolve({ ok: true });
      }
      return original(msg, ...rest);
    };
  });
}

/** Queries recorded by spyOnWebSearch, in call order. */
async function webSearchCalls(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => (globalThis as any).__ffWebSearchCalls ?? []);
}

/**
 * Like spyOnWebSearch, but the intercepted 'search/web-query' message rejects
 * instead of resolving — simulates the background relay failing, so the
 * failure path in App.tsx's handleWebSearch (toast on rejection) can be tested
 * without depending on a real chrome.search.query failure.
 */
async function spyOnWebSearchRejecting(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const api = (globalThis as any).browser ?? (globalThis as any).chrome;
    const original = api.runtime.sendMessage.bind(api.runtime);
    (globalThis as any).__ffWebSearchCalls = [];
    api.runtime.sendMessage = (msg: any, ...rest: any[]) => {
      if (msg && msg.type === 'search/web-query') {
        (globalThis as any).__ffWebSearchCalls.push(msg.query);
        return Promise.reject(new Error('web search relay failed'));
      }
      return original(msg, ...rest);
    };
  });
}

/** Type a query into the search input and wait for the results box to appear. */
async function typeQuery(
  page: import('@playwright/test').Page,
  query: string,
): Promise<void> {
  const input = searchInput(page);
  await input.click();
  await input.fill(query);
  // Ensure React has re-rendered before assertions.
  await page.waitForSelector('#ff-search-results', { timeout: 5_000 });
}

/** Blur the search input so it loses focus (needed before testing focus shortcuts). */
async function blurSearch(page: import('@playwright/test').Page): Promise<void> {
  // Click somewhere on the page body that is not the search widget.
  await page.locator('.ff-app').click({ position: { x: 10, y: 10 } });
  await expect(searchInput(page)).not.toBeFocused();
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('search', () => {
  // ── Typing shows dropdown ──────────────────────────────────────────────────

  test('typing a query shows a results dropdown with matching items', async ({ newtabPage }) => {
    // WHY: the dropdown is the core affordance; users must see results appear
    //      as they type so they can navigate to the right bookmark.
    await typeQuery(newtabPage, 'GitHub');

    await expect(resultsBox(newtabPage)).toBeVisible();
    // GitHub is a root-level Work bookmark; at least one item must be shown.
    const items = resultItems(newtabPage);
    await expect(items).not.toHaveCount(0);
    // The first result's title contains the query term.
    await expect(items.first().locator('.ff-results__title')).toContainText('GitHub');
  });

  // ── Ctrl+K focuses search ──────────────────────────────────────────────────

  test('Ctrl+K focuses the search input from anywhere on the page', async ({ newtabPage }) => {
    // WHY: the keyboard shortcut is the fastest path to search; it must work
    //      even when focus is on the page body, not the input.
    await blurSearch(newtabPage);

    await newtabPage.keyboard.press('Control+k');

    await expect(searchInput(newtabPage)).toBeFocused();
  });

  // ── "/" focuses search ─────────────────────────────────────────────────────

  test('"/" key focuses the search input when not typing in an input', async ({ newtabPage }) => {
    // WHY: "/" is an alternative shortcut for keyboard-first users; it must
    //      focus search from the page body without inserting "/" into the input.
    await blurSearch(newtabPage);

    // Press "/" from the page body — not from inside any input element.
    await newtabPage.keyboard.press('/');

    await expect(searchInput(newtabPage)).toBeFocused();
    // The "/" character itself must not appear as a typed value.
    await expect(searchInput(newtabPage)).toHaveValue('');
  });

  // ── Enter on a folder result navigates to that folder ─────────────────────

  test('Enter on a folder result opens the folder overlay', async ({ newtabPage }) => {
    // WHY: folders reached via search must navigate into the folder just as
    //      clicking the tile would — the user expects to land in that folder.
    // "Project Apollo" is a folder in the Work workspace root.
    await typeQuery(newtabPage, 'Project Apollo');

    // Confirm we have at least one result and the first is a folder.
    const items = resultItems(newtabPage);
    await expect(items.first()).toBeVisible();
    await expect(items.first().locator('.ff-results__url')).toHaveText('Folder');

    // Activate the first result via Enter — folderOpenMode defaults to 'overlay'.
    await searchInput(newtabPage).press('Enter');

    // The folder overlay must open, showing the folder's name.
    await expect(newtabPage.locator('.ff-folder-overlay')).toBeVisible();
    // The dropdown closes (search value was cleared by openAt()).
    await expect(resultsBox(newtabPage)).toHaveCount(0);
  });

  // ── Enter on a bookmark result opens it ───────────────────────────────────

  test('Enter on a bookmark result navigates to the bookmark URL', async ({ newtabPage, world }) => {
    // WHY: activating a bookmark from search is the primary use-case; the URL
    //      must open (same tab, since openLinksInNewTab=false by default).
    void world; // Ensures world is seeded — the fixture dependency is implicit.

    // Stub the Slack bookmark's host so the same-tab navigation below doesn't
    // depend on live DNS/network — the URL assertion stays exactly as strict.
    await newtabPage.route(/slack\.com/, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
    );

    await typeQuery(newtabPage, 'Slack');

    const items = resultItems(newtabPage);
    await expect(items.first()).toBeVisible();
    // Confirm the first item is a bookmark (not a folder) and shows "Slack".
    await expect(items.first().locator('.ff-results__title')).toContainText('Slack');
    await expect(items.first().locator('.ff-results__url')).not.toHaveText('Folder');

    // openLinksInNewTab=false → window.location.href, so the newtab page
    // navigates away. Listen for the navigation request before pressing Enter.
    const navPromise = newtabPage.waitForEvent('framenavigated', { timeout: 5_000 });
    await searchInput(newtabPage).press('Enter');
    const frame = await navPromise;
    // The navigated URL must be the Slack bookmark URL (or its normalised form).
    expect(frame.url()).toMatch(/slack\.com/);
  });

  // ── No-match state now shows a web-search fallback, not bare "No matches." ──

  test('a query with no matching bookmarks shows the web-search fallback row', async ({ newtabPage }) => {
    // WHY: a dead-end "No matches." used to strand the user; they should be
    //      offered a one-click path to search the web for the same text.
    const input = searchInput(newtabPage);
    await input.click();
    await input.fill('xyzzy-no-such-bookmark-12345');

    await expect(resultsBox(newtabPage)).toBeVisible();
    await expect(resultsBox(newtabPage)).toContainText('Search the web for "xyzzy-no-such-bookmark-12345"');
    await expect(resultsBox(newtabPage)).not.toContainText('No matches.');
    await expect(resultItems(newtabPage)).toHaveCount(0);
  });

  // ── Whitespace-only input: no fallback, no web search ─────────────────────

  test('whitespace-only input shows no fallback row and never triggers a web search', async ({ newtabPage }) => {
    // WHY: a trimmed-empty query has nothing meaningful to search for; showing
    //      a fallback row or firing webSearch('') would be a confusing no-op.
    await spyOnWebSearch(newtabPage);
    const input = searchInput(newtabPage);
    await input.click();
    await input.fill('   ');

    await expect(resultsBox(newtabPage)).toBeVisible();
    await expect(fallbackRow(newtabPage)).toHaveCount(0);

    // Enter must be a no-op — there is no row (bookmark or fallback) to activate.
    await input.press('Enter');
    expect(await webSearchCalls(newtabPage)).toEqual([]);
  });

  // ── Bookmark matches suppress the fallback row ────────────────────────────

  test('when bookmark matches exist, no fallback row renders alongside them', async ({ newtabPage }) => {
    // WHY: the fallback is a last resort; it must never appear next to real
    //      matches, or users could mistakenly trigger a web search instead of
    //      picking the bookmark they were looking for.
    await typeQuery(newtabPage, 'GitHub');

    await expect(resultItems(newtabPage)).not.toHaveCount(0);
    await expect(fallbackRow(newtabPage)).toHaveCount(0);
  });

  // ── Explicit http(s) URL: Enter opens it directly ─────────────────────────

  test('an explicit https:// URL with zero matches opens it directly on Enter', async ({ newtabPage }) => {
    // WHY: typing a full URL is an explicit navigation intent — it must open,
    //      not be routed through a web search, when it doesn't match a bookmark.
    const url = 'https://example.com/no-such-bookmark-xyz';

    // Stub the target host so the same-tab navigation below doesn't depend on
    // live DNS/network — the URL assertion stays exactly as strict.
    await newtabPage.route(url, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
    );

    await typeQuery(newtabPage, url);

    await expect(resultsBox(newtabPage)).toContainText(url);
    await expect(resultsBox(newtabPage)).not.toContainText('No matches.');

    // openLinksInNewTab=false by default → window.location.href navigation.
    const navPromise = newtabPage.waitForEvent('framenavigated', { timeout: 5_000 });
    await searchInput(newtabPage).press('Enter');
    const frame = await navPromise;
    expect(frame.url()).toBe(url);
  });

  // ── Bare domain / free text: fallback row, click activates web search ─────

  test('a bare domain never auto-navigates; the fallback row triggers a web search on click', async ({ newtabPage }) => {
    // WHY: only an explicit scheme counts as navigation intent (see url.ts);
    //      a bare host must not silently open a URL the user didn't fully type.
    await spyOnWebSearch(newtabPage);
    await typeQuery(newtabPage, 'example.com');

    await expect(resultsBox(newtabPage)).toContainText('Search the web for "example.com"');
    await expect(resultItems(newtabPage)).toHaveCount(0);

    await fallbackRow(newtabPage).click();

    await expect.poll(() => webSearchCalls(newtabPage)).toEqual(['example.com']);
    // Mirrors openAt(): the dropdown closes and the input clears on activation.
    await expect(searchInput(newtabPage)).toHaveValue('');
  });

  // ── Keyboard nav reaches + activates the fallback row ─────────────────────

  test('keyboard nav reaches the fallback row and Enter activates it', async ({ newtabPage }) => {
    // WHY: keyboard-only users must be able to reach and trigger the same
    //      fallback action as a mouse click, with correct a11y focus tracking.
    await spyOnWebSearch(newtabPage);
    await typeQuery(newtabPage, 'nonsense-query-that-matches-nothing');

    await expect(fallbackRow(newtabPage)).toBeVisible();
    await expect(searchInput(newtabPage)).toHaveAttribute('aria-activedescendant', 'ff-search-opt-0');

    await searchInput(newtabPage).press('ArrowDown');
    await expect(fallbackRow(newtabPage)).toHaveAttribute('data-active', 'true');
    await expect(searchInput(newtabPage)).toHaveAttribute('aria-activedescendant', 'ff-search-opt-0');

    await searchInput(newtabPage).press('Enter');
    await expect.poll(() => webSearchCalls(newtabPage)).toEqual(['nonsense-query-that-matches-nothing']);
  });

  // ── Web search relay failure: error toast, not a silent no-op ─────────────

  test('a failed web search shows an error toast instead of failing silently', async ({ newtabPage }) => {
    // WHY: handleWebSearch used to swallow a rejected webSearch() call with an
    //      empty catch — the user saw nothing and had no idea the click/Enter
    //      did anything. It must now surface a visible error toast.
    await spyOnWebSearchRejecting(newtabPage);
    await typeQuery(newtabPage, 'nonsense-query-that-matches-nothing');

    await expect(fallbackRow(newtabPage)).toBeVisible();
    await fallbackRow(newtabPage).click();

    await expect.poll(() => webSearchCalls(newtabPage)).toEqual(['nonsense-query-that-matches-nothing']);

    const toast = newtabPage.locator('.ff-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(/Couldn.t open web search\./);
  });

  // ── Web search success: confirmation toast, not a silent no-op ────────────

  test('a successful web search shows a confirmation toast', async ({ newtabPage }) => {
    // WHY: chrome.search.query() opens results in a NEW tab, so the newtab page
    //      the user is looking at shows no change at all when the click merely
    //      succeeds — a working click reads identically to a broken one unless
    //      the current tab gives its own visible acknowledgment.
    await spyOnWebSearch(newtabPage);
    await typeQuery(newtabPage, 'nonsense-query-that-matches-nothing');

    await expect(fallbackRow(newtabPage)).toBeVisible();
    await fallbackRow(newtabPage).click();

    await expect.poll(() => webSearchCalls(newtabPage)).toEqual(['nonsense-query-that-matches-nothing']);

    const toast = newtabPage.locator('.ff-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Searching the web for "nonsense-query-that-matches-nothing"');
  });

  // ── Relevance ordering: title match outranks host/URL match ───────────────

  test('title matches are ranked above URL-only matches for the same query', async ({ newtabPage }) => {
    // WHY: users think in terms of bookmark titles, not raw URLs. Surfacing
    //      the title match first reduces the number of items they need to scan.
    //
    // Strategy: query "linear"
    //   - "Linear" (root bookmark, url: linear.app)
    //       title exact match  → SCORE_TITLE_EXACT  = 1000
    //       host exact match   → SCORE_HOST_EXACT   =  800   (linear.app → "linear")
    //       total ≥ 1800
    //   - "Sprint Board" (inside Project Apollo, url: linear.app)
    //       title: no match
    //       host exact match   → SCORE_HOST_EXACT   =  800
    //       total = 800
    //
    // Every "Linear" title-match must appear before "Sprint Board" (URL-only match).
    await typeQuery(newtabPage, 'linear');

    const items = resultItems(newtabPage);
    await expect(items).not.toHaveCount(0);

    // Collect all result titles in DOM order.
    const titles = await items.locator('.ff-results__title').allTextContents();
    const normalised = titles.map((t) => t.trim());

    // Confirm both expected items are present.
    expect(normalised).toContain('Linear');
    expect(normalised).toContain('Sprint Board');

    // The LAST occurrence of "Linear" must appear before the FIRST occurrence
    // of "Sprint Board". This is the meaningful ranking invariant: any item
    // matched by title outscores any item matched only by its host URL.
    const lastLinearIdx = normalised.lastIndexOf('Linear');
    const firstSprintBoardIdx = normalised.indexOf('Sprint Board');
    expect(lastLinearIdx).toBeLessThan(firstSprintBoardIdx);
  });
});
