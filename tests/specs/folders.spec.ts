/**
 * Folder navigation â€” overlay mode (default) and page mode.
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
let childId: string;
let grandId: string;

test.beforeEach(async ({ newtabPage }) => {
  await clearExtensionStorage(newtabPage);
  rootId = await createTestFolder(newtabPage, 'Nav Root');
  childId = await createSubFolder(newtabPage, rootId, 'Child');
  grandId = await createSubFolder(newtabPage, childId, 'Grand');
  await createTestBookmark(newtabPage, childId, 'Child BM', 'https://child.example.com');
  await setupDefaultWorkspace(newtabPage, rootId);
});

test.afterEach(async ({ newtabPage }) => {
  await removeBookmarkTree(newtabPage, rootId);
});

test('overlay mode: clicking a folder opens the folder overlay', async ({ newtabPage }) => {
  await patchSettings(newtabPage, { folderOpenMode: 'overlay' });
  await reloadNewtab(newtabPage);

  await tileById(newtabPage, childId).click();
  await expect(newtabPage.locator('.ff-folder-overlay')).toBeVisible();
  await expect(newtabPage.locator('.ff-folder-overlay__crumb[data-here="true"]')).toHaveText('Child');

  await newtabPage.getByRole('button', { name: 'Close overlay' }).click();
  await expect(newtabPage.locator('.ff-folder-overlay')).toHaveCount(0);
});

test('overlay back button climbs one level after navigating into a subfolder', async ({ newtabPage }) => {
  await patchSettings(newtabPage, { folderOpenMode: 'overlay' });
  await reloadNewtab(newtabPage);

  await tileById(newtabPage, childId).click();
  await tileById(newtabPage, grandId).click();
  await expect(newtabPage.locator('.ff-folder-overlay__crumb[data-here="true"]')).toHaveText('Grand');

  await newtabPage.getByRole('button', { name: 'Back to parent folder' }).click();
  await expect(newtabPage.locator('.ff-folder-overlay__crumb[data-here="true"]')).toHaveText('Child');
});

test('overlay Backspace navigates up one level', async ({ newtabPage }) => {
  await patchSettings(newtabPage, { folderOpenMode: 'overlay' });
  await reloadNewtab(newtabPage);

  await tileById(newtabPage, childId).click();
  await tileById(newtabPage, grandId).click();
  await newtabPage.keyboard.press('Backspace');
  await expect(newtabPage.locator('.ff-folder-overlay__crumb[data-here="true"]')).toHaveText('Child');
});

test('overlay breadcrumb click jumps to an ancestor', async ({ newtabPage }) => {
  await patchSettings(newtabPage, { folderOpenMode: 'overlay' });
  await reloadNewtab(newtabPage);

  await tileById(newtabPage, childId).click();
  await tileById(newtabPage, grandId).click();

  // Crumb for "Child" is the non-current breadcrumb at index 0.
  await newtabPage.locator('.ff-folder-overlay__crumb', { hasText: 'Child' }).first().click();
  await expect(newtabPage.locator('.ff-folder-overlay__crumb[data-here="true"]')).toHaveText('Child');
});

test('page mode: clicking a folder pushes the path and shows breadcrumb', async ({ newtabPage }) => {
  await patchSettings(newtabPage, { folderOpenMode: 'page' });
  await reloadNewtab(newtabPage);

  await tileById(newtabPage, childId).click();
  await expect(newtabPage.locator('.ff-page-view')).toBeVisible();
  await expect(newtabPage.locator('.ff-crumb__here')).toHaveText('Child');
});

test('page mode: workspace crumb returns to root', async ({ newtabPage }) => {
  await patchSettings(newtabPage, { folderOpenMode: 'page' });
  await reloadNewtab(newtabPage);

  await tileById(newtabPage, childId).click();
  await expect(newtabPage.locator('.ff-page-view')).toBeVisible();

  // The first breadcrumb button is the workspace root; clicking it returns home.
  await newtabPage.locator('.ff-crumb__btn').first().click();
  await expect(newtabPage.locator('.ff-page-view')).toHaveCount(0);
  // At root the trailing "here" crumb is gone (only the workspace button remains).
  await expect(newtabPage.locator('.ff-crumb__here')).toHaveCount(0);
});
