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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

  // ── No-match empty state ───────────────────────────────────────────────────

  test('a query with no matching bookmarks shows "No matches." copy', async ({ newtabPage }) => {
    // WHY: the empty state prevents users from thinking search is broken when
    //      their query genuinely matches nothing.
    const input = searchInput(newtabPage);
    await input.click();
    await input.fill('xyzzy-no-such-bookmark-12345');

    await expect(resultsBox(newtabPage)).toBeVisible();
    await expect(resultsBox(newtabPage)).toContainText('No matches.');
    await expect(resultItems(newtabPage)).toHaveCount(0);
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
