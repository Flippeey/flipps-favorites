/**
 * Multi-select via shift/ctrl click; Esc clears selection; scope isolation.
 */
import { test, expect } from '../fixtures/extension-context.js';
import {
  clearExtensionStorage,
  createSubFolder,
  createTestBookmark,
  createTestFolder,
  patchSettings,
  reloadNewtab,
  removeBookmarkTree,
  setupDefaultWorkspace,
  tileById,
} from '../fixtures/bookmark-helpers.js';

let rootId: string;
let a: string;
let b: string;
let c: string;
let sectionId: string;
let inSection: string;

test.beforeEach(async ({ newtabPage }) => {
  await clearExtensionStorage(newtabPage);
  rootId = await createTestFolder(newtabPage, 'Sel Root');
  a = await createTestBookmark(newtabPage, rootId, 'Alpha', 'https://alpha.example.com');
  b = await createTestBookmark(newtabPage, rootId, 'Beta', 'https://beta.example.com');
  c = await createTestBookmark(newtabPage, rootId, 'Gamma', 'https://gamma.example.com');
  sectionId = await createSubFolder(newtabPage, rootId, 'Section');
  inSection = await createTestBookmark(newtabPage, sectionId, 'Section BM', 'https://section.example.com');
  await setupDefaultWorkspace(newtabPage, rootId);
  // List mode so the subfolder's bookmark renders alongside root bookmarks with a different scope.
  await patchSettings(newtabPage, { folderMode: 'list' });
  await reloadNewtab(newtabPage);
});

test.afterEach(async ({ newtabPage }) => {
  await removeBookmarkTree(newtabPage, rootId);
});

test('shift-click two tiles in the same scope marks both selected', async ({ newtabPage }) => {
  // Grid mode gives predictable scoping: root bookmarks render in a single
  // TilesView scope, rather than split across section scopes in list mode.
  await patchSettings(newtabPage, { folderMode: 'grid' });
  await reloadNewtab(newtabPage);

  const ta = tileById(newtabPage, a);
  const tb = tileById(newtabPage, b);
  await ta.click({ modifiers: ['Shift'] });
  await tb.click({ modifiers: ['Shift'] });
  await expect(ta).toHaveAttribute('data-selected', 'true');
  await expect(tb).toHaveAttribute('data-selected', 'true');
});

test('ctrl-click toggles selection of an individual tile', async ({ newtabPage }) => {
  await patchSettings(newtabPage, { folderMode: 'grid' });
  await reloadNewtab(newtabPage);

  const ta = tileById(newtabPage, a);
  await ta.click({ modifiers: ['Control'] });
  await expect(ta).toHaveAttribute('data-selected', 'true');
  await ta.click({ modifiers: ['Control'] });
  await expect(ta).toHaveAttribute('data-selected', 'false');
});

test('selecting in a section scopes the selection to that section', async ({ newtabPage }) => {
  // Sections mode: clicking a tile inside the section should mark it selected
  // and the section's [data-scope-folder-id] container should match.
  const sectionTile = tileById(newtabPage, inSection);
  await sectionTile.click({ modifiers: ['Shift'] });
  await expect(sectionTile).toHaveAttribute('data-selected', 'true');

  const scope = await sectionTile.evaluate(
    (el) => el.closest('[data-scope-folder-id]')?.getAttribute('data-scope-folder-id') ?? '',
  );
  expect(scope).toBe(sectionId);
});

test('Escape clears the selection', async ({ newtabPage }) => {
  await patchSettings(newtabPage, { folderMode: 'grid' });
  await reloadNewtab(newtabPage);

  const ta = tileById(newtabPage, a);
  await ta.click({ modifiers: ['Shift'] });
  await expect(ta).toHaveAttribute('data-selected', 'true');
  await newtabPage.keyboard.press('Escape');
  await expect(ta).toHaveAttribute('data-selected', 'false');
});
