/**
 * "Remember last workspace" toggle boot behaviour.
 *
 * WHY: The toggle in Settings → Navigation must control which workspace is
 * shown on boot. When OFF, the user always starts at the first (ordered)
 * workspace regardless of which one they were on when they closed the tab.
 * When ON, the last-used workspace is restored. Without this fix, the
 * persisted activeWorkspaceId was always used on boot, making the toggle a
 * no-op.
 */
import { test, expect } from '../fixtures/world.js';
import { patchSettings, waitForSettings } from '../fixtures/seeding.js';
import { workspaceTab } from '../fixtures/selectors.js';

test('rememberLastFolder=false → boot always shows the first workspace, not the last-used one', async ({ newtabPage, world }) => {
  // The promo world order is: Work, Personal, AI, Design, Gaming.
  // Work (index 0) is active at load. Ensure flag is off.
  await patchSettings(newtabPage, { rememberLastFolder: false });
  await waitForSettings(newtabPage, (s) => s.rememberLastFolder === false);

  // Switch to the AI workspace (index 2) — this persists activeWorkspaceId=AI.
  const aiTab = workspaceTab(newtabPage, world.workspaceIds.AI);
  await aiTab.click();
  await expect(aiTab).toHaveClass(/is-active/, { timeout: 2_000 });

  // Wait for activeWorkspaceId to be committed to storage.
  await waitForSettings(newtabPage, (s) => s.activeWorkspaceId === world.workspaceIds.AI);

  // Reload — with rememberLastFolder=false, boot must show the FIRST workspace (Work).
  await newtabPage.reload();
  await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });

  await expect(workspaceTab(newtabPage, world.workspaceIds.Work)).toHaveClass(/is-active/, {
    timeout: 5_000,
  });
  await expect(workspaceTab(newtabPage, world.workspaceIds.AI)).not.toHaveClass(/is-active/);
});

test('rememberLastFolder=true → boot restores the last-used workspace (no regression)', async ({ newtabPage, world }) => {
  // Ensure flag is on.
  await patchSettings(newtabPage, { rememberLastFolder: true });
  await waitForSettings(newtabPage, (s) => s.rememberLastFolder === true);

  // Switch to the Design workspace.
  const designTab = workspaceTab(newtabPage, world.workspaceIds.Design);
  await designTab.click();
  await expect(designTab).toHaveClass(/is-active/, { timeout: 2_000 });

  await waitForSettings(newtabPage, (s) => s.activeWorkspaceId === world.workspaceIds.Design);

  // Reload — with rememberLastFolder=true, boot must restore Design.
  await newtabPage.reload();
  await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });

  await expect(workspaceTab(newtabPage, world.workspaceIds.Design)).toHaveClass(/is-active/, {
    timeout: 5_000,
  });
  await expect(workspaceTab(newtabPage, world.workspaceIds.Work)).not.toHaveClass(/is-active/);
});
