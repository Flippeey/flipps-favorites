// Guards: the first-run flow on Firefox. A genuinely fresh profile (temporary
// addon install, no seed/reset call) must show the onboarding dialog, and
// skipping it must leave the user with a usable default workspace — without
// that, workspace-scoped settings (view mode, sort mode) have nowhere to
// persist (see Onboarding.tsx handleSkip doc comment).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import { launchFirefoxWithExtension, type FirefoxSession } from '../launch';
import { ONBOARDING_ROOT } from '../selectors';
import { clickByText } from '../wait';
import { getWorkspaces } from '../seed';

describe('onboarding', () => {
  let session: FirefoxSession;
  let page: Page;

  beforeAll(async () => {
    // A fresh Firefox profile with the extension freshly installed has never
    // been seeded — no resetStorage/seed call here is the point of this spec.
    session = await launchFirefoxWithExtension();
    page = await session.newtabPage();
  });

  afterAll(async () => {
    await session.close();
  });

  it('shows the onboarding dialog on a fresh profile', async () => {
    await page.waitForSelector(ONBOARDING_ROOT, { timeout: 10_000 });
    const dialog = await page.$(ONBOARDING_ROOT);
    expect(dialog).not.toBeNull();
  });

  it('skipping onboarding creates a default workspace', async () => {
    await clickByText(page, '.ff-iconbtn', 'Skip');
    await page.waitForSelector(ONBOARDING_ROOT, { hidden: true, timeout: 10_000 });

    const workspaces = await getWorkspaces(page);
    expect(workspaces.length).toBeGreaterThan(0);
  });
});
