/**
 * Onboarding template-picker integration tests.
 *
 * Uses the `freshPage` fixture (fresh install, no prior state) so the onboarding
 * wizard opens automatically (the install event fires markOnboardingPending).
 * Bookmark trees are seeded via page.evaluate before the page is reloaded so the
 * service worker's tree is fresh when the onboarding wizard reads it.
 *
 * CRITICAL FACTS encoded here (do not remove these comments):
 *
 * 1. Bar-fallback-first rule: On a fresh install with no preSelected folders,
 *    onboarding's workspace step (step 2) defaults to the bookmarks bar ('1'). Every
 *    test that asserts a badge at the template step (step 3) FIRST asserts that the
 *    bar ('1') is the active workspace-step selection by checking its folder button
 *    shows the selected check icon — the badge depends on that selection being in place.
 *    FolderMultiPicker marks a selected folder visually (accent border + check icon)
 *    but does NOT use aria-pressed or data-* attributes — the check icon is the
 *    DOM signal for selection.
 *
 * 2. Researcher overlay is ALWAYS present for power-user trees in e2e: because
 *    chrome.bookmarks.create stamps dateAdded=Date.now(), all freshly seeded
 *    bookmarks have recentAdditionRatio≈1.0, which exceeds the 0.40 threshold.
 *    Therefore the Researcher temporal overlay fires deterministically on any
 *    power-user classified tree. Tests MUST expect the Researcher hint — asserting
 *    its absence would be wrong and flaky.
 *
 * 3. TemplatePicker cards render data-selected="true" (string "true") when selected,
 *    absent (undefined) when not selected. Assertions use toHaveAttribute('data-selected', 'true').
 */
import { test, expect } from '../fixtures/world.js';
import {
  reloadNewtab,
  seedFlatHoarderTree,
  seedDeepOrganizedTree,
} from '../fixtures/bookmark-helpers.js';
import { getWorkspaces, patchSettings } from '../fixtures/seeding.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to step N starting from step 0 by clicking Next N times. */
async function advanceToStep(
  onboard: import('@playwright/test').Locator,
  targetStep: number,
): Promise<void> {
  for (let i = 0; i < targetStep; i++) {
    await onboard.getByRole('button', { name: /Next/i }).click();
  }
}

/**
 * Assert that the Bookmarks bar folder ('1') is the active selection in the workspace
 * step (step 2). FolderMultiPicker renders an Ico name="check" inside a selected folder
 * button. We find the "Bookmarks bar" button and assert it contains a check icon (svg).
 * WHY: the Hoarder/PowerUser badge at the template step (step 3) depends on bar '1' being selected.
 */
async function assertBarFallbackSelected(
  onboard: import('@playwright/test').Locator,
): Promise<void> {
  const body = onboard.locator('.ff-onboard__body');
  // The bar folder card button has the exact accessible name "Bookmarks bar"
  // (Chrome system name). Use exact:true to avoid matching the sibling "Expand
  // Bookmarks bar" toggle that appears when the bar has sub-folders.
  const barFolderBtn = body.getByRole('button', { name: 'Bookmarks bar', exact: true });
  await expect(barFolderBtn).toBeVisible({ timeout: 5_000 });
  // A selected folder renders a check icon (svg) alongside the folder icon.
  // This is the only DOM signal for selection in FolderMultiPicker (no aria-pressed).
  // When selected: folder icon + check icon = 2 svg elements.
  await expect(barFolderBtn.locator('svg')).toHaveCount(2); // folder icon + check icon
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

test('Hoarder tree: bookmarks bar is the fallback workspace-step selection; Hoarder card is badged at the template step', async ({ freshPage }) => {
  // Seed 120 flat bookmarks under the bookmarks bar ('1').
  // folderedRatio ≈ 0 + volume > 35 → Hoarder classification.
  await seedFlatHoarderTree(freshPage);

  // Reload so the wizard reads the freshly seeded tree.
  // markOnboardingPending persists across reloads — wizard re-opens.
  await reloadNewtab(freshPage);

  const onboard = freshPage.locator('.ff-onboard');
  await expect(onboard).toBeVisible();

  // Navigate to step 2 (workspace folder picker): welcome → appearance → workspace.
  await onboard.getByRole('button', { name: /Next/i }).click(); // -> appearance
  await onboard.getByRole('button', { name: /Next/i }).click(); // -> workspace

  // Step 2: BAR-FALLBACK-FIRST — assert the bookmarks bar is the active selection
  // before advancing. Required before any badge assertion at the template step.
  await assertBarFallbackSelected(onboard);

  // Navigate to template picker (step 3).
  await onboard.getByRole('button', { name: /Next/i }).click(); // -> template picker

  // Hoarder card must be recommended (classifier sees flat structure + high volume).
  const hoarderCard = onboard.locator('[data-archetype-id="hoarder"]');
  await expect(hoarderCard).toBeVisible();
  // data-recommended={recommended || undefined} in JSX → React renders "true" for boolean true
  await expect(hoarderCard).toHaveAttribute('data-recommended', 'true');

  // The badge element is visible and contains "Recommended" text (not color-only).
  await expect(hoarderCard.locator('.ff-template-card__badge')).toBeVisible();
  await expect(hoarderCard.locator('.ff-template-card__badge')).toContainText('Recommended');

  // The recommended card is also preselected.
  // data-selected={selected || undefined} in JSX → React renders "true" for boolean true
  await expect(hoarderCard).toHaveAttribute('data-selected', 'true');

  // The "why" reasons block is visible (encodes WHY this fits the user's bookmarks).
  await expect(hoarderCard.locator('.ff-template-card__why')).toBeVisible();
});

test('Large organized tree: Power-user card is badged AND the Researcher hint is present (recency saturation)', async ({ freshPage }) => {
  // Seed 8 folders × 8 bookmarks nested two levels deep under bar ('1').
  // folderedRatio ≈ 1.0 + maxDepth = 2 → Power-user wins.
  // Researcher overlay fires because recentAdditionRatio ≈ 1.0 (all bookmarks are new).
  // This is EXPECTED — do NOT assert the hint's absence.
  await seedDeepOrganizedTree(freshPage);
  await reloadNewtab(freshPage);

  const onboard = freshPage.locator('.ff-onboard');
  await expect(onboard).toBeVisible();

  // Navigate to step 2 (workspace folder picker): welcome → appearance → workspace.
  await onboard.getByRole('button', { name: /Next/i }).click(); // -> appearance
  await onboard.getByRole('button', { name: /Next/i }).click(); // -> workspace

  // Step 2: BAR-FALLBACK-FIRST — bar '1' is selected (it contains the seeded folders).
  await assertBarFallbackSelected(onboard);

  // Navigate to template picker (step 3).
  await onboard.getByRole('button', { name: /Next/i }).click(); // -> template picker

  // Power-user card is recommended (structural signals: high folderedRatio + depth).
  const powerUserCard = onboard.locator('[data-archetype-id="power-user"]');
  await expect(powerUserCard).toBeVisible();
  // data-recommended={recommended || undefined} → React renders "true" for boolean true
  await expect(powerUserCard).toHaveAttribute('data-recommended', 'true');
  await expect(powerUserCard.locator('.ff-template-card__badge')).toContainText('Recommended');
  // data-selected={selected || undefined} → React renders "true" for boolean true
  await expect(powerUserCard).toHaveAttribute('data-selected', 'true');

  // Researcher hint IS present on the Researcher card (temporal overlay fires
  // deterministically because dateAdded≈now → recentAdditionRatio≈1.0 > 0.40
  // and folderedRatio≈1.0 > 0.70). This is MANDATORY to assert — do not remove.
  const researcherCard = onboard.locator('[data-archetype-id="researcher"]');
  await expect(researcherCard).toBeVisible();
  await expect(researcherCard.locator('.ff-template-card__hint')).toBeVisible();
  await expect(researcherCard.locator('.ff-template-card__hint')).toContainText('research-like activity');
});

test('Choosing a template then finishing: created workspace carries the template view/sort', async ({ freshPage }) => {
  // Seed a minimal flat tree so classification yields a result and a workspace is created.
  await seedFlatHoarderTree(freshPage, 50);
  await reloadNewtab(freshPage);

  const onboard = freshPage.locator('.ff-onboard');
  await expect(onboard).toBeVisible();

  // Advance through steps 0→1→2→3 (template picker).
  await advanceToStep(onboard, 3);

  // Explicitly pick the "Researcher" template card (folderMode=list, sort=created/desc).
  const researcherCard = onboard.locator('[data-archetype-id="researcher"]');
  await researcherCard.click();
  // data-selected={selected || undefined} → React renders "true" for boolean true
  await expect(researcherCard).toHaveAttribute('data-selected', 'true');

  // Advance to tips (step 4) and finish.
  await onboard.getByRole('button', { name: /Next/i }).click();
  await onboard.getByRole('button', { name: /Get started/i }).click();
  await expect(onboard).toHaveCount(0);

  // Assert the created workspace carries the Researcher template's overrides:
  // folderMode=list, bookmarkSortMode=created, bookmarkSortDirection=desc.
  const workspaces = await getWorkspaces(freshPage);
  expect(workspaces.length).toBeGreaterThan(0);
  const ws = workspaces[0]!;
  expect(ws.folderMode).toBe('list');
  expect(ws.bookmarkSortMode).toBe('created');
  expect(ws.bookmarkSortDirection).toBe('desc');

  // The app renders without crashing after onboarding completes.
  await expect(freshPage.locator('.ff-app')).toBeVisible();
});

test('Preselected preset (no manual card click) is applied: power-user → list view', async ({ freshPage }) => {
  // REGRESSION: the classifier preselects a template card, but the user accepts it
  // without clicking. The created workspace must still carry the PRESELECTED preset's
  // view/sort — not the grid default. (Earlier a stale pending view-mode clobbered it.)
  await seedDeepOrganizedTree(freshPage); // → power-user preselected (Structured Library, list)
  await reloadNewtab(freshPage);

  const onboard = freshPage.locator('.ff-onboard');
  await expect(onboard).toBeVisible();

  // Advance to the template step and confirm power-user is the preselected card,
  // then finish WITHOUT clicking any card.
  await advanceToStep(onboard, 3);
  const powerUserCard = onboard.locator('[data-archetype-id="power-user"]');
  await expect(powerUserCard).toHaveAttribute('data-selected', 'true');

  await onboard.getByRole('button', { name: /Next/i }).click(); // -> tips
  await onboard.getByRole('button', { name: /Get started/i }).click();
  await expect(onboard).toHaveCount(0);

  // Created workspace carries the power-user preset: list view, manual sort.
  const workspaces = await getWorkspaces(freshPage);
  expect(workspaces.length).toBeGreaterThan(0);
  expect(workspaces[0]!.folderMode).toBe('list');
  expect(workspaces[0]!.bookmarkSortMode).toBe('manual');
});

test('Skip path: workspace keeps default view/sort (grid/manual/asc)', async ({ freshPage }) => {
  // No seeding needed — just skip through onboarding without choosing a template.
  const onboard = freshPage.locator('.ff-onboard');
  await expect(onboard).toBeVisible();

  // Skip onboarding without choosing a template.
  await onboard.getByRole('button', { name: 'Skip' }).click();
  await expect(onboard).toHaveCount(0);

  // The app renders without crashing after skip.
  await expect(freshPage.locator('.ff-app')).toBeVisible();

  // If any workspace was created (by the skip path), verify it has defaults:
  // grid view, manual sort, ascending direction.
  const workspaces = await getWorkspaces(freshPage);
  for (const ws of workspaces) {
    expect(ws.folderMode).toBe('grid');
    expect(ws.bookmarkSortMode).toBe('manual');
    expect(ws.bookmarkSortDirection).toBe('asc');
  }
});

test('Re-run onboarding: with explicit template opt-in, workspace overrides apply', async ({ freshPage }) => {
  // Set up: seed a flat tree and complete onboarding with the Casual template
  // (folderMode=grid, bookmarkSortMode=name, bookmarkSortDirection=asc).
  await seedFlatHoarderTree(freshPage, 50);
  await reloadNewtab(freshPage);

  const onboard = freshPage.locator('.ff-onboard');
  await expect(onboard).toBeVisible();

  // First run: pick Casual template and finish to create the baseline workspace.
  await advanceToStep(onboard, 3);
  const casualCard = onboard.locator('[data-archetype-id="casual"]');
  await casualCard.click();
  // data-selected={selected || undefined} → React renders "true" for boolean true
  await expect(casualCard).toHaveAttribute('data-selected', 'true');
  await onboard.getByRole('button', { name: /Next/i }).click();
  await onboard.getByRole('button', { name: /Get started/i }).click();
  await expect(onboard).toHaveCount(0);

  // Baseline workspace carries Casual overrides.
  const workspacesBefore = await getWorkspaces(freshPage);
  expect(workspacesBefore.length).toBeGreaterThan(0);
  const wsBefore = workspacesBefore[0]!;
  expect(wsBefore.folderMode).toBe('grid');
  expect(wsBefore.bookmarkSortMode).toBe('name');

  // Re-run onboarding via the replay button, this time choosing Researcher template.
  // WHY: verifies the opt-in path on re-run actually applies the new template.
  await freshPage.getByRole('button', { name: 'Replay onboarding' }).click();
  const onboard2 = freshPage.locator('.ff-onboard');
  await expect(onboard2).toBeVisible();

  await advanceToStep(onboard2, 3);
  // Explicitly choose Researcher (folderMode=list, sort=created/desc).
  const researcherCard = onboard2.locator('[data-archetype-id="researcher"]');
  await researcherCard.click();
  // data-selected={selected || undefined} → React renders "true" for boolean true
  await expect(researcherCard).toHaveAttribute('data-selected', 'true');
  await onboard2.getByRole('button', { name: /Next/i }).click();
  await onboard2.getByRole('button', { name: /Get started/i }).click();
  await expect(onboard2).toHaveCount(0);

  // Opt-in applied: workspace now carries Researcher overrides.
  const workspacesAfter = await getWorkspaces(freshPage);
  expect(workspacesAfter.length).toBeGreaterThan(0);
  const wsAfter = workspacesAfter[0]!;
  expect(wsAfter.folderMode).toBe('list');
  expect(wsAfter.bookmarkSortMode).toBe('created');
  expect(wsAfter.bookmarkSortDirection).toBe('desc');
});

test('Re-run with multiple workspaces never duplicates or repoints a workspace', async ({ world, newtabPage }) => {
  // REGRESSION: the reported "a workspace gets duplicated" bug. Completing a re-run
  // used to retarget the ACTIVE workspace's rootFolderId to the first SELECTED folder.
  // When the active workspace was not the one owning that first folder, its record was
  // repointed and its old root orphaned — then recreated as a DUPLICATE. A re-run must
  // NEVER repoint an existing workspace's root.
  const personaNames = ['Work', 'Personal', 'AI', 'Design', 'Gaming'];
  const before = world.workspaces;
  expect(before.length).toBe(5);

  // Peek which folder is FIRST in the default selection (preSelected[0] == the first
  // recommendation card). Skip without changing anything — Skip never mutates state.
  await newtabPage.getByRole('button', { name: 'Replay onboarding' }).click();
  const peek = newtabPage.locator('.ff-onboard');
  await expect(peek).toBeVisible();
  await advanceToStep(peek, 2); // -> workspace step
  const firstCardText = (await peek.locator('.ff-onboard__body').getByRole('button').first().textContent()) ?? '';
  const firstFolder = personaNames.find(p => firstCardText.startsWith(p));
  expect(firstFolder).toBeTruthy(); // the first recommendation is one of the persona folders
  await peek.getByRole('button', { name: 'Skip' }).click();
  await expect(peek).toHaveCount(0);

  // Make a DIFFERENT workspace active, so the buggy retarget would necessarily move a
  // root (active.root !== firstFolder's root). This is what makes the test bite.
  const target = before.find(w => w.name !== firstFolder)!;
  const targetRootBefore = target.rootFolderId;
  await patchSettings(newtabPage, { activeWorkspaceId: target.id });
  await reloadNewtab(newtabPage);

  // Replay and complete accepting the default selection (no card click) — the path
  // that triggered the bug.
  await newtabPage.getByRole('button', { name: 'Replay onboarding' }).click();
  const onboard = newtabPage.locator('.ff-onboard');
  await expect(onboard).toBeVisible();
  await advanceToStep(onboard, 4); // -> tips (welcome→appearance→workspace→template→tips)
  await onboard.getByRole('button', { name: /Get started/i }).click();
  await expect(onboard).toHaveCount(0);

  const after = await getWorkspaces(newtabPage);

  // The active workspace was NOT repointed: it keeps its original root.
  expect(after.find(w => w.id === target.id)?.rootFolderId).toBe(targetRootBefore);

  // No duplicate workspaces: every rootFolderId is still unique across all records.
  const roots = after.map(w => w.rootFolderId);
  expect(new Set(roots).size).toBe(roots.length);

  // Every originally-seeded workspace still exists exactly once.
  for (const w of before) {
    expect(after.filter(a => a.id === w.id)).toHaveLength(1);
  }
});
