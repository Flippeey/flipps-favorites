import { describe, expect, it } from 'vitest';
import { isMonotoneLetterPlaceholder } from '@/background/icons/icon-image';

/**
 * Placeholder-gate DECISION tests — deterministic coverage for the live
 * `rejectMonotonePlaceholder` code path in `fetchAndValidateImage`.
 *
 * WHY THIS FILE EXISTS: The Playwright spec (icon-horse-gate.spec.ts) depended
 * on un-mocked live third-party services (icon.horse, duckduckgo.com) and its
 * core assertion `not.toBe('iconhorse')` was non-falsifiable — it passed
 * whenever DDG/origin returned ANYTHING, even if the placeholder gate never
 * ran. These tests inject synthetic pixel data and directly assert the gate's
 * accept/reject decision, so they genuinely FAIL if the gate logic is removed
 * or its thresholds are broken.
 *
 * WHAT IS NOT TESTED HERE: The OffscreenCanvas 16x16 downscale step
 * (`looksLikeLetterPlaceholder` → `createImageBitmap` + `drawImage`) that
 * feeds pixel data to `isMonotoneLetterPlaceholder`. That canvas path cannot
 * run in Vitest/Node; it is exercised live by the extension in the service
 * worker.
 */

// -- Helpers ------------------------------------------------------------------

/** Fill a 16x16 RGBA buffer with a single solid color. */
function solidPixels(r: number, g: number, b: number, a = 255): Uint8ClampedArray {
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return data;
}

/**
 * Build a realistic Icon Horse placeholder pattern: dominant light-grey
 * background + darker grey letter glyph + anti-alias fringe.
 *
 * @param bgRatio  fraction of pixels that are the background color (0..1)
 * @param bgR/G/B  background RGB
 * @param fgR/G/B  letter glyph RGB
 */
function placeholderPixels(
  bgRatio: number,
  bgR: number, bgG: number, bgB: number,
  fgR: number, fgG: number, fgB: number,
): Uint8ClampedArray {
  const total = 16 * 16;
  const bgCount = Math.floor(total * bgRatio);
  const fgCount = Math.floor(total * 0.07);
  const data = new Uint8ClampedArray(total * 4);
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (p < bgCount) {
      data[i] = bgR; data[i + 1] = bgG; data[i + 2] = bgB;
    } else if (p < bgCount + fgCount) {
      data[i] = fgR; data[i + 1] = fgG; data[i + 2] = fgB;
    } else {
      // anti-alias fringe — average of bg and fg
      data[i] = Math.round((bgR + fgR) / 2);
      data[i + 1] = Math.round((bgG + fgG) / 2);
      data[i + 2] = Math.round((bgB + fgB) / 2);
    }
    data[i + 3] = 255;
  }
  return data;
}

// -- REJECT tests (placeholders the gate must catch) --------------------------

describe('placeholder gate: rejects monotone-grey placeholders', () => {
  // WHY: dela.nl's Icon Horse response is a grey square with a grey letter "D".
  // Measured: 5 colors, 89.8% dominant, grey 226,226,226, brightness 226.
  // If the gate is removed, this test fails — it is the primary regression guard.
  it('rejects dela.nl-style IH placeholder (grey 226 bg + grey 120 letter)', () => {
    const data = placeholderPixels(0.90, 226, 226, 226, 120, 120, 120);
    expect(isMonotoneLetterPlaceholder(data)).toBe(true);
  });

  // WHY: phidec.twinq.nl's IH response is the same pattern at higher bg ratio.
  // Measured: 4 colors, 93.8% dominant, grey 226,226,226.
  it('rejects phidec.twinq.nl-style IH placeholder (grey 226, 93% dominant)', () => {
    const data = placeholderPixels(0.935, 226, 226, 226, 120, 120, 120);
    expect(isMonotoneLetterPlaceholder(data)).toBe(true);
  });

  // WHY: A solid light-grey image in the brightness band is the simplest
  // positive case — ensures the gate fires on pure light-grey.
  it('rejects solid light-grey at brightness 220', () => {
    const data = solidPixels(220, 220, 220);
    expect(isMonotoneLetterPlaceholder(data)).toBe(true);
  });
});

// -- ACCEPT tests (real favicons the gate must NOT catch) ----------------------

describe('placeholder gate: accepts real distinct-color favicons', () => {
  // WHY: YouTube's favicon is red (255,0,51). High saturation escapes the
  // achromatic check despite having few colors and high dominant ratio.
  it('accepts YouTube-like red favicon (saturated, not grey)', () => {
    const data = placeholderPixels(0.93, 255, 0, 51, 255, 255, 255);
    expect(isMonotoneLetterPlaceholder(data)).toBe(false);
  });

  // WHY: Twitter/X is black on white. Dominant is black — achromatic with
  // spread 0, but brightness 0 is far below the [200, 240] band.
  it('accepts Twitter-like black-on-white favicon (brightness 0)', () => {
    const data = placeholderPixels(0.89, 0, 0, 0, 255, 255, 255);
    expect(isMonotoneLetterPlaceholder(data)).toBe(false);
  });

  // WHY: Apple's silver logo (~153,153,158). Achromatic grey, but brightness
  // ~155 is below the 200 floor. Must not be mistaken for an IH placeholder.
  it('accepts Apple-silver favicon (brightness ~155, below floor)', () => {
    const data = placeholderPixels(0.92, 153, 153, 158, 180, 180, 183);
    expect(isMonotoneLetterPlaceholder(data)).toBe(false);
  });

  // WHY: A mid-grey brand logo at brightness 170. Below the 200 floor.
  it('accepts mid-grey brand logo (brightness 170, below floor)', () => {
    const data = placeholderPixels(0.91, 170, 170, 170, 200, 200, 200);
    expect(isMonotoneLetterPlaceholder(data)).toBe(false);
  });

  // WHY: A gradient image has many distinct colors — early-exits at step 1.
  it('accepts a multi-color gradient (many distinct colors)', () => {
    const data = new Uint8ClampedArray(16 * 16 * 4);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4;
        data[i] = Math.floor((x / 16) * 255);
        data[i + 1] = Math.floor((y / 16) * 255);
        data[i + 2] = 128;
        data[i + 3] = 255;
      }
    }
    expect(isMonotoneLetterPlaceholder(data)).toBe(false);
  });

  // WHY: Pure white is achromatic but brightness 255 exceeds the ceiling of 240.
  it('accepts pure white image (brightness 255, above ceiling)', () => {
    const data = solidPixels(255, 255, 255);
    expect(isMonotoneLetterPlaceholder(data)).toBe(false);
  });

  // WHY: Fully transparent has no opaque pixels — cannot be classified.
  it('accepts fully transparent image (no opaque pixels)', () => {
    const data = solidPixels(226, 226, 226, 0);
    expect(isMonotoneLetterPlaceholder(data)).toBe(false);
  });
});
