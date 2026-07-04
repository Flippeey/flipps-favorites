// Guards: the extension loads at all on Firefox, the background page (not a
// service worker — Firefox MV3 uses background.page, see architecture.md)
// boots, and the message pipeline is alive end to end.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import { launchFirefoxWithExtension, reloadAndWaitForApp, type FirefoxSession } from '../launch';
import { resetStorage, seedMinimal } from '../seed';
import { APP_SHELL, BOOKMARK_TILE } from '../selectors';
import { waitForCount } from '../wait';

describe('boot', () => {
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

  it('renders the app shell on a fresh Firefox profile', async () => {
    await reloadAndWaitForApp(page);
    const shell = await page.$(APP_SHELL);
    expect(shell).not.toBeNull();
  });

  it('reaches the extension message pipeline and renders seeded tiles', async () => {
    // If the background page failed to boot, or the message pipeline were
    // broken, seedMinimal's `workspaces/create` + `settings/patch` sends would
    // hang/throw and no tiles would ever render — this is the end-to-end guard.
    await seedMinimal(page, { rootBookmarks: 3 });
    await reloadAndWaitForApp(page);
    await waitForCount(page, BOOKMARK_TILE, 3, 10_000);
  });
});
