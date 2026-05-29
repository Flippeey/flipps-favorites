/**
 * Settings → Appearance (Customize workspace drawer).
 *
 * Why each test matters: visual settings live on the per-workspace record and
 * are applied optimistically to CSS variables / data-* attributes. If a change
 * doesn't reach the DOM the user sees nothing. If it doesn't persist through a
 * reload the workspace state has drifted from what the user chose.
 */
import { test, expect } from '../fixtures/world.js';
import { openSettingsSection, reloadNewtab } from '../fixtures/bookmark-helpers.js';
import { patchWorkspace } from '../fixtures/seeding.js';
import type { Page } from '@playwright/test';

const WORK_WS_ID = 'promo-work';

// ---------------------------------------------------------------------------
// Local helper — open the Customize drawer on the Appearance section.
// ---------------------------------------------------------------------------
async function openAppearance(page: Page): Promise<void> {
  await openSettingsSection(page, 'appearance');
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
test.describe('settings-appearance: theme', () => {
  test('Light card sets data-theme=light on documentElement', async ({ newtabPage }) => {
    await openAppearance(newtabPage);
    await newtabPage.locator('.ff-themecard--light').click();
    await expect.poll(() =>
      newtabPage.evaluate(() => document.documentElement.dataset.theme),
    ).toBe('light');
  });

  test('Dark card sets data-theme=dark on documentElement', async ({ newtabPage }) => {
    // Start from light so we have a known before-state.
    await patchWorkspace(newtabPage, WORK_WS_ID, { themeMode: 'light' });
    await reloadNewtab(newtabPage);

    await openAppearance(newtabPage);
    await newtabPage.locator('.ff-themecard--dark').click();
    await expect.poll(() =>
      newtabPage.evaluate(() => document.documentElement.dataset.theme),
    ).toBe('dark');
  });

  test('System toggle activates system-preference mode (card state updates)', async ({ newtabPage }) => {
    // Ensure we start from a non-system mode so toggling is meaningful.
    await patchWorkspace(newtabPage, WORK_WS_ID, { themeMode: 'light' });
    await reloadNewtab(newtabPage);

    await openAppearance(newtabPage);
    const toggleRow = newtabPage.locator('.ff-row', { hasText: 'Use system preference' });
    await toggleRow.locator('.ff-toggle').click();
    // After enabling system mode the toggle should be aria-checked=true.
    await expect(toggleRow.locator('.ff-toggle')).toHaveAttribute('aria-checked', 'true');
  });

  test('theme choice persists after reload', async ({ newtabPage }) => {
    await openAppearance(newtabPage);
    await newtabPage.locator('.ff-themecard--light').click();
    // Wait for the optimistic write to settle before reloading.
    await expect.poll(() =>
      newtabPage.evaluate(() => document.documentElement.dataset.theme),
    ).toBe('light');

    await reloadNewtab(newtabPage);
    await expect.poll(() =>
      newtabPage.evaluate(() => document.documentElement.dataset.theme),
    ).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// Accent
// ---------------------------------------------------------------------------
test.describe('settings-appearance: accent', () => {
  test('accent chip sets --accent CSS variable on documentElement', async ({ newtabPage }) => {
    await openAppearance(newtabPage);
    // Teal chip (index 1, value #23867B).
    await newtabPage.locator('.ff-accentchip').nth(1).click();
    const accent = await newtabPage.evaluate(() =>
      document.documentElement.style.getPropertyValue('--accent'),
    );
    expect(accent.toLowerCase()).toBe('#23867b');
  });

  test('accent chip persists through reload', async ({ newtabPage }) => {
    await openAppearance(newtabPage);
    // Red chip (index 6, value #C75252).
    await newtabPage.locator('.ff-accentchip').nth(6).click();
    await expect.poll(() =>
      newtabPage.evaluate(() =>
        document.documentElement.style.getPropertyValue('--accent').toLowerCase(),
      ),
    ).toBe('#c75252');

    await reloadNewtab(newtabPage);
    const after = await newtabPage.evaluate(() =>
      document.documentElement.style.getPropertyValue('--accent').toLowerCase(),
    );
    expect(after).toBe('#c75252');
  });

  test('custom accent color picker applies the chosen hex', async ({ newtabPage }) => {
    await openAppearance(newtabPage);
    // The Accent section's custom button is the first .ff-accent-custom-btn
    // inside the section that has the "Accent" heading — the background panel
    // also renders a BgColorPicker with its own custom button.
    const accentSection = newtabPage.locator('.ff-set-section', { hasText: 'Accent' });
    const colorInput = accentSection.locator('input[type="color"]').first();
    await colorInput.evaluate((el: HTMLInputElement, hex: string) => {
      el.value = hex;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, '#FF5500');

    await expect.poll(() =>
      newtabPage.evaluate(() =>
        document.documentElement.style.getPropertyValue('--accent').toLowerCase(),
      ),
    ).toBe('#ff5500');
  });
});

// ---------------------------------------------------------------------------
// Background — Solid mode
// ---------------------------------------------------------------------------
test.describe('settings-appearance: background solid', () => {
  test('selecting Solid mode sets data-bg=solid on the app shell', async ({ newtabPage }) => {
    await openAppearance(newtabPage);
    // The three background mode cards are rendered with capitalized text.
    await newtabPage.locator('.ff-themecard', { hasText: 'Solid' }).click();
    await expect(newtabPage.locator('.ff-app')).toHaveAttribute('data-bg', 'solid');
  });

  test('Solid preset color chip applies and data-bg stays solid', async ({ newtabPage }) => {
    await patchWorkspace(newtabPage, WORK_WS_ID, { backgroundMode: 'solid' });
    await reloadNewtab(newtabPage);

    await openAppearance(newtabPage);
    // Noir preset is the first .ff-accentchip inside the solid panel's BgColorPicker.
    // We need the chip inside the bg panel, not the accent chips — they share the class,
    // so filter by aria-label.
    const noirChip = newtabPage.locator('.ff-accentchip[aria-label="Noir"]');
    await noirChip.click();
    await expect(newtabPage.locator('.ff-app')).toHaveAttribute('data-bg', 'solid');
  });
});

// ---------------------------------------------------------------------------
// Background — Gradient mode
// ---------------------------------------------------------------------------
test.describe('settings-appearance: background gradient', () => {
  test('selecting Gradient mode sets data-bg=gradient on the app shell', async ({ newtabPage }) => {
    // Start from solid so the click is a real transition.
    await patchWorkspace(newtabPage, WORK_WS_ID, { backgroundMode: 'solid' });
    await reloadNewtab(newtabPage);

    await openAppearance(newtabPage);
    await newtabPage.locator('.ff-themecard', { hasText: 'Gradient' }).click();
    await expect(newtabPage.locator('.ff-app')).toHaveAttribute('data-bg', 'gradient');
  });

  test('gradient style button click updates data-bg-style on the app shell', async ({ newtabPage }) => {
    await patchWorkspace(newtabPage, WORK_WS_ID, { backgroundMode: 'gradient', gradientStyle: 'top' });
    await reloadNewtab(newtabPage);

    await openAppearance(newtabPage);
    // The gradient style cards are labeled Aurora/Mesh/Vignette etc.
    await newtabPage.locator('.ff-themecard', { hasText: 'Aurora' }).click();
    await expect(newtabPage.locator('.ff-app')).toHaveAttribute('data-bg-style', 'aurora');
  });

  test('gradient intensity slider updates --gradient-intensity CSS variable', async ({ newtabPage }) => {
    await patchWorkspace(newtabPage, WORK_WS_ID, { backgroundMode: 'gradient', gradientIntensity: 100 });
    await reloadNewtab(newtabPage);

    await openAppearance(newtabPage);
    const slider = newtabPage.locator('.ff-bg-row', { hasText: 'Intensity' }).locator('input[type="range"]');
    await expect(slider).toBeVisible();

    // Move the slider to 50 via fill (Playwright sets value + dispatches input/change).
    await slider.fill('50');
    // onPreview fires on 'input', writing --gradient-intensity = 50/100 = 0.5.
    await expect.poll(() =>
      newtabPage.evaluate(() =>
        document.querySelector('.ff-app')
          ? (document.querySelector('.ff-app') as HTMLElement).style.getPropertyValue('--gradient-intensity')
          : null,
      ),
    ).toBe('0.5');
  });
});

// ---------------------------------------------------------------------------
// Background — Wallpaper mode
// ---------------------------------------------------------------------------
test.describe('settings-appearance: background wallpaper', () => {
  test('selecting Wallpaper mode shows the Browse file input and label', async ({ newtabPage }) => {
    await openAppearance(newtabPage);
    await newtabPage.locator('.ff-themecard', { hasText: 'Wallpaper' }).click();
    await expect(newtabPage.locator('.ff-app')).toHaveAttribute('data-bg', 'wallpaper');
    // The wallpaper picker renders "No wallpaper selected" and a Browse button.
    await expect(newtabPage.locator('.ff-row__label', { hasText: 'No wallpaper selected' })).toBeVisible();
    await expect(newtabPage.locator('.ff-btn', { hasText: 'Browse' })).toBeVisible();
  });
});
