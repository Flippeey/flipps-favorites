// Guards: the settings patch pipeline + storage on Firefox. Theme is chosen
// from the workspace-scoped Appearance drawer and applied to
// document.documentElement.dataset.theme (NOT the .ff-app element — see
// src/newtab/App.tsx / lib/accent.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import { launchFirefoxWithExtension, reloadAndWaitForApp, type FirefoxSession } from '../launch';
import { resetStorage, seedMinimal, waitForWorkspace } from '../seed';
import { clickByText } from '../wait';

async function currentThemeAttr(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.dataset.theme ?? null);
}

describe('settings', () => {
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
    await seedMinimal(page, { rootBookmarks: 1 });
    await reloadAndWaitForApp(page);
  });

  it('changing the theme in the Appearance drawer persists across reload', async () => {
    const before = await currentThemeAttr(page);
    const targetTheme = before === 'light' ? 'dark' : 'light';

    await page.click('[aria-label="Customize workspace"]');
    await page.waitForSelector('.ff-drawer', { timeout: 5_000 });
    await clickByText(page, '.ff-drawer__navitem', 'Appearance');

    const themeCardSelector = `.ff-themecard--${targetTheme}`;
    await page.waitForSelector(themeCardSelector, { timeout: 5_000 });
    await page.click(themeCardSelector);

    await page.waitForFunction(
      (expected: string) => document.documentElement.dataset.theme === expected,
      { timeout: 5_000 },
      targetTheme,
    );
    // The DOM/optimistic update above lands before the workspaces/patch write
    // commits to storage — wait for the committed record too, or a reload
    // immediately after can race the write (same class of race as the
    // workspaces spec's handleSwitchWorkspace case).
    await waitForWorkspace(page, 'ws-minimal', (ws) => ws.themeMode === targetTheme);

    await reloadAndWaitForApp(page);
    const after = await currentThemeAttr(page);
    expect(after).toBe(targetTheme);
  });
});
