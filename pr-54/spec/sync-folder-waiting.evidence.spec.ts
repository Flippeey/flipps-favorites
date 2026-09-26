/**
 * Evidence: synced workspaces whose folder isn't in this browser's bookmarks
 * wait instead of showing a wrong folder, and a workspace whose folder was
 * deleted shows the removed-folder state.
 */
import { test, expect } from '../../fixtures/world.js';
import { openSettingsSection } from '../../fixtures/bookmark-helpers.js';
import { capture } from '../evidence.js';

test.describe('synced folders this browser does not have', () => {
  test('an imported workspace waits for its bookmarks; a deleted folder shows the removed state', async ({ newtabPage, world }, testInfo) => {
    const page = newtabPage;
    const template = world.workspaces[0]!;
    const { rootFolder: _unused, ...base } = template as typeof template & { rootFolder?: unknown };
    const payload = {
      schema: 'flipps-workspace-transfer',
      schemaVersion: 5,
      exportedAt: Date.now(),
      settings: {},
      workspaces: [{
        ...base,
        id: 'evidence-reading',
        name: 'Reading list',
        rootFolderId: 'firefox-only-guid',
        rootFolder: { rootKind: 'toolbar', path: ['Reading list'], fingerprint: ['0a0b0c0d', '1a1b1c1d', '2a2b2c2d'] },
      }],
      workspaceWallpapers: {},
      iconOverrides: [],
      folderIcons: [],
      bookmarkUsage: [],
    };

    await openSettingsSection(page, 'backup');
    await page.locator('.ff-drawer input[type="file"]').setInputFiles({
      name: 'from-firefox.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(payload)),
    });

    await expect(page.getByText('1 synced workspace needs a folder', { exact: true })).toBeVisible();
    await capture(page, testInfo, 'toast-after-import');

    const waiting = page.getByTestId('waiting-workspaces');
    await expect(waiting).toContainText('Reading list');
    await expect(waiting.getByRole('button', { name: 'Choose folder' })).toBeVisible();
    await expect(waiting.getByRole('button', { name: 'Not used in this browser' })).toBeVisible();
    await waiting.scrollIntoViewIfNeeded();
    await capture(page, testInfo, 'backup-waiting-line');

    // Hidden from the tabs: it has no folder here.
    await expect(page.locator('[data-workspace-id="evidence-reading"]')).toHaveCount(0);

    // Delete the active workspace's folder behind the page's back.
    await page.evaluate(async (id) => { await chrome.bookmarks.removeTree(id); }, world.rootFolderId);
    await page.reload();
    const notice = page.getByTestId('folder-notice');
    await expect(notice).toContainText('This workspace’s folder was removed');
    await capture(page, testInfo, 'removed-folder');

    await notice.getByRole('button', { name: 'Choose folder' }).click();
    await expect(page.locator('.ff-dialog[role="dialog"]')).toBeVisible();
    await capture(page, testInfo, 'choose-folder-dialog');
  });
});
