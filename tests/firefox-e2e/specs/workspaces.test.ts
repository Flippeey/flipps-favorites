// Guards: per-key storage.sync writes on Firefox (the 8 KB quota architecture
// — each WorkspaceRecord lives under its own `workspace:<id>` key) plus
// cross-reload persistence of the active workspace on Firefox's storage
// backend.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import { launchFirefoxWithExtension, reloadAndWaitForApp, type FirefoxSession } from '../launch';
import { createWorkspace, patchSettings, resetStorage, seedMinimal, waitForSettings } from '../seed';
import { workspaceTabSelector } from '../selectors';
import { waitForAttribute } from '../wait';
import type { WorkspaceRecord } from '../../../src/shared/models';

const DEFAULTS: Omit<WorkspaceRecord, 'id' | 'name' | 'rootFolderId'> = {
  themeMode: 'system',
  accentColor: '#3F72DC',
  backgroundMode: 'gradient',
  solidBackgroundColor: '',
  gradientStyle: 'top',
  gradientColorSource: 'accent',
  gradientCustomColor: '#3F72DC',
  gradientIntensity: 100,
  backgroundOpacity: 70,
  backgroundFitMode: 'cover',
  backgroundPositionMode: 'center',
  layoutPreset: 'balanced',
  favoritesColumnGap: 24,
  favoritesRowGap: 20,
  bookmarkTileWidth: 130,
  bookmarkIconSize: 75,
  tileShape: 'squircle',
  showTileLabels: true,
  folderMode: 'grid',
  bookmarkSortMode: 'manual',
  bookmarkSortDirection: 'asc',
};

describe('workspaces', () => {
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

  it('switching workspaces and reloading remembers the active workspace', async () => {
    // seedMinimal creates+activates 'ws-minimal'; add a second workspace
    // sharing the same root folder so switching has somewhere real to go.
    const minimal = await seedMinimal(page, { rootBookmarks: 1 });
    const secondId = 'ws-second';
    await createWorkspace(page, {
      ...DEFAULTS,
      id: secondId,
      name: 'Second',
      rootFolderId: minimal.rootFolderId,
    });
    // "Remember last workspace" must be on for this spec: with it off (the
    // seedMinimal default), main.tsx always boots to workspaceOrder[0]
    // regardless of which workspace was last active — that's correct product
    // behaviour for the toggle, but it would make this persistence assertion
    // meaningless. See src/newtab/main.tsx lines ~24-34.
    await patchSettings(page, { workspaceOrder: ['ws-minimal', secondId], rememberLastFolder: true });
    await reloadAndWaitForApp(page);

    const secondTab = workspaceTabSelector(secondId);
    await page.waitForSelector(secondTab, { timeout: 10_000 });
    await page.click(secondTab);
    await waitForAttribute(page, secondTab, 'aria-selected', 'true', 10_000);
    // handleSwitchWorkspace updates the UI optimistically ~130ms before the
    // settings/patch write actually commits to storage (see
    // useWorkspaceActions.ts) — wait for the committed value, not just the
    // DOM, or a reload immediately after the click can race the write and
    // read back the pre-switch workspace.
    await waitForSettings(page, (s) => s.activeWorkspaceId === secondId);

    await reloadAndWaitForApp(page);
    await page.waitForSelector(secondTab, { timeout: 10_000 });
    await waitForAttribute(page, secondTab, 'aria-selected', 'true', 10_000);
  });
});
