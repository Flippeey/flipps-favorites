/**
 * Backup: exporting settings downloads a JSON payload describing every seeded
 * workspace. Why it matters — export is the user's only path to move workspaces
 * across machines; a broken export silently loses their setup. We assert the
 * download fires and its parsed payload carries the seeded workspaces.
 */
import { test, expect } from '../fixtures/world.js';
import { openSettingsSection } from '../fixtures/bookmark-helpers.js';
import { readFile } from 'node:fs/promises';

interface WorkspaceExport {
  workspaces: unknown[];
}

test.describe('backup', () => {
  test('export produces a JSON file containing the seeded workspaces', async ({ newtabPage, world }) => {
    await openSettingsSection(newtabPage, 'backup');

    const exportButton = newtabPage.getByRole('button', { name: /Export/ });
    const downloadPromise = newtabPage.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.json$/);

    const path = await download.path();
    const raw = await readFile(path, 'utf-8');
    const payload = JSON.parse(raw) as WorkspaceExport;

    expect(Array.isArray(payload.workspaces)).toBe(true);
    // The seeded world has five promo personas; export must carry them all.
    expect(payload.workspaces.length).toBe(world.workspaces.length);
  });
});
