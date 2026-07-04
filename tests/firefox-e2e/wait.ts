// Wait helpers for the Puppeteer suite. Puppeteer has no Playwright-style
// auto-retrying `expect(locator).toHaveText()` matcher, so every assertion on
// async-rendered UI goes through one of these instead of a bare `page.$`.
import type { Page } from 'puppeteer';

const DEFAULT_TIMEOUT = 5_000;

/** Wait until an element matching `selector` contains `text` (substring match). */
export async function waitForText(
  page: Page,
  selector: string,
  text: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<void> {
  await page.waitForFunction(
    (sel: string, expected: string) => {
      const el = document.querySelector(sel);
      return !!el && (el.textContent ?? '').includes(expected);
    },
    { timeout },
    selector,
    text,
  );
}

/** Wait until the number of elements matching `selector` equals `count`. */
export async function waitForCount(
  page: Page,
  selector: string,
  count: number,
  timeout = DEFAULT_TIMEOUT,
): Promise<void> {
  await page.waitForFunction(
    (sel: string, expected: number) => document.querySelectorAll(sel).length === expected,
    { timeout },
    selector,
    count,
  );
}

/** Wait until an attribute on the (single) element matching `selector` equals `value`. */
export async function waitForAttribute(
  page: Page,
  selector: string,
  attribute: string,
  value: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<void> {
  await page.waitForFunction(
    (sel: string, attr: string, expected: string) => {
      const el = document.querySelector(sel);
      return !!el && el.getAttribute(attr) === expected;
    },
    { timeout },
    selector,
    attribute,
    value,
  );
}

/**
 * Click a button/element whose visible text matches `text` (substring), found
 * among elements matching `selector`. Puppeteer's `text/...` selectors
 * silently fail on BiDi/Firefox (spike-confirmed) — this is the replacement.
 */
export async function clickByText(page: Page, selector: string, text: string): Promise<void> {
  const clicked = await page.evaluate(
    (sel: string, expected: string) => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(sel));
      const match = candidates.find((el) => (el.textContent ?? '').trim().includes(expected));
      if (!match) return false;
      match.click();
      return true;
    },
    selector,
    text,
  );
  if (!clicked) {
    throw new Error(`clickByText: no element matching "${selector}" contains text "${text}"`);
  }
}
