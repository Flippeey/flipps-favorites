import { describe, expect, it } from 'vitest';
import {
  countDistinctColorsFromPixels,
  isMonotoneLetterPlaceholder,
} from '@/background/icons/icon-image';
import {
  placeholderMaxDistinctColors,
  placeholderMinDominantRatio,
  placeholderMaxSaturation,
  placeholderMinBrightness,
  placeholderMaxBrightness,
} from '@/background/icons/icon-constants';

/**
 * Color-diversity gate: rejects monotone Icon Horse letter-placeholders so the
 * pipeline falls through to DuckDuckGo. Uses a compound condition (not just
 * color count) to avoid false-rejecting simple real favicons like YouTube or
 * Twitter that also have few distinct colors.
 *
 * Compound condition for "placeholder":
 *   1. Few distinct colors (<= placeholderMaxDistinctColors)
 *   2. Dominant color covers >= placeholderMinDominantRatio of opaque pixels
 *   3. Dominant color is achromatic (max channel spread <= placeholderMaxSaturation)
 *   4. Dominant color is light-grey (brightness in [placeholderMinBrightness, placeholderMaxBrightness])
 *
 * Calibrated from real Icon Horse responses (see calibration data below):
 *   Placeholders (dela.nl, phidec.twinq.nl): 4-5 colors, 89-93% dominant,
 *     grey rgb(226,226,226), brightness ~226 -- inside [200, 240]
 *   Real low-color favicons: YouTube (RED, saturated), Twitter (BLACK, brightness 0),
 *     Spotify (GREEN, saturated), Microsoft (multicolor, no single dominant)
 *   Real grey logos (MUST be kept): Apple silver (brightness ~155, below floor),
 *     grey "W" (brightness 170, below floor), dark grey (brightness 85, below floor)
 *
 * The narrow light-grey brightness band [200, 240] is the key discriminator:
 * it catches IH's light-grey placeholders while letting dark/mid grey logos escape.
 */

// -- Helpers ------------------------------------------------------------------

function solidPixels(width: number, height: number, r: number, g: number, b: number, a = 255): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return data;
}

function twoColorPixels(
  width: number, height: number,
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  const halfHeight = Math.floor(height / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const useFirst = y < halfHeight;
      data[i] = useFirst ? r1 : r2;
      data[i + 1] = useFirst ? g1 : g2;
      data[i + 2] = useFirst ? b1 : b2;
      data[i + 3] = 255;
    }
  }
  return data;
}

function gradientPixels(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = Math.floor((x / width) * 255);
      data[i + 1] = Math.floor((y / height) * 255);
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  return data;
}

// -- countDistinctColorsFromPixels tests ---------------------------------------

describe('countDistinctColorsFromPixels', () => {
  it('returns 1 for a solid-color image', () => {
    const pixels = solidPixels(16, 16, 100, 150, 200);
    expect(countDistinctColorsFromPixels(pixels)).toBe(1);
  });

  it('returns 2 for a two-color image', () => {
    const pixels = twoColorPixels(16, 16, 68, 68, 68, 255, 255, 255);
    expect(countDistinctColorsFromPixels(pixels)).toBe(2);
  });

  it('returns many distinct colors for a gradient image', () => {
    const pixels = gradientPixels(16, 16);
    const count = countDistinctColorsFromPixels(pixels);
    expect(count).toBeGreaterThan(20);
  });

  it('ignores fully transparent pixels', () => {
    const pixels = solidPixels(16, 16, 100, 150, 200, 0);
    expect(countDistinctColorsFromPixels(pixels)).toBe(0);
  });

  it('ignores semi-transparent pixels below alpha 128', () => {
    const data = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 200; data[i + 1] = 100; data[i + 2] = 50; data[i + 3] = 127;
    }
    expect(countDistinctColorsFromPixels(data)).toBe(0);
  });

  it('counts pixels at alpha exactly 128', () => {
    const data = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 200; data[i + 1] = 100; data[i + 2] = 50; data[i + 3] = 128;
    }
    expect(countDistinctColorsFromPixels(data)).toBe(1);
  });

  it('quantizes nearby colors into the same bucket', () => {
    const data = new Uint8ClampedArray(4 * 4);
    data[0] = 100; data[1] = 150; data[2] = 200; data[3] = 255;
    data[4] = 101; data[5] = 150; data[6] = 200; data[7] = 255;
    data[8] = 102; data[9] = 151; data[10] = 201; data[11] = 255;
    data[12] = 104; data[13] = 150; data[14] = 200; data[15] = 255;
    expect(countDistinctColorsFromPixels(data)).toBe(2);
  });
});

// -- isMonotoneLetterPlaceholder tests ----------------------------------------

describe('isMonotoneLetterPlaceholder', () => {
  // WHY: Icon Horse placeholders are grey bg (226,226,226) + darker grey letter
  // (120,120,120). This compound condition (few colors + dominant + achromatic)
  // must detect them.
  it('detects a grey-on-grey Icon Horse placeholder (dela.nl pattern)', () => {
    // Simulate: ~90% grey bg (226,226,226) + ~7% darker grey letter (120,120,120)
    // + ~3% anti-alias edge pixels (various greys)
    const data = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < data.length; i += 4) {
      const pixelIndex = i / 4;
      if (pixelIndex < 230) {
        // 90% background grey
        data[i] = 226; data[i + 1] = 226; data[i + 2] = 226;
      } else if (pixelIndex < 248) {
        // 7% letter grey
        data[i] = 120; data[i + 1] = 120; data[i + 2] = 120;
      } else {
        // 3% anti-alias
        data[i] = 180; data[i + 1] = 180; data[i + 2] = 180;
      }
      data[i + 3] = 255;
    }
    expect(isMonotoneLetterPlaceholder(data)).toBe(true);
  });

  // WHY: YouTube's favicon is a red play button (255,0,51) on transparency.
  // Dominant color is RED (saturated), so it must NOT be flagged despite having
  // only 4 distinct colors and 93% dominant ratio.
  it('does NOT flag YouTube-like red-on-white favicon', () => {
    // 93% red, 4% white, 3% anti-alias
    const data = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < data.length; i += 4) {
      const pixelIndex = i / 4;
      if (pixelIndex < 238) {
        data[i] = 255; data[i + 1] = 0; data[i + 2] = 51; // red
      } else {
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; // white
      }
      data[i + 3] = 255;
    }
    expect(isMonotoneLetterPlaceholder(data)).toBe(false);
  });

  // WHY: Twitter's X logo is black (0,0,0) on white. Dominant is black -- achromatic
  // with spread 0 (<= placeholderMaxSaturation). However, black has brightness 0,
  // well below the light-grey floor of 200. The brightness band [200, 240] ensures
  // only IH's specific light-grey (~226) is caught, not dark/black logos.
  it('does NOT flag Twitter-like black-on-white favicon', () => {
    // 89% black, 10% white, 1% anti-alias grey
    const data = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < data.length; i += 4) {
      const pixelIndex = i / 4;
      if (pixelIndex < 228) {
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; // black
      } else {
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; // white
      }
      data[i + 3] = 255;
    }
    expect(isMonotoneLetterPlaceholder(data)).toBe(false);
  });

  // WHY: Spotify favicon is green (30,215,96). Saturated color should not trigger.
  it('does NOT flag Spotify-like green favicon', () => {
    const data = solidPixels(16, 16, 30, 215, 96);
    expect(isMonotoneLetterPlaceholder(data)).toBe(false);
  });

  // WHY: Microsoft favicon has 4 equal colors (25% each). No single dominant.
  it('does NOT flag a four-quadrant equal-split image', () => {
    const data = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < data.length; i += 4) {
      const pixelIndex = i / 4;
      const quadrant = pixelIndex % 4;
      if (quadrant === 0) { data[i] = 242; data[i + 1] = 80; data[i + 2] = 34; }
      else if (quadrant === 1) { data[i] = 127; data[i + 1] = 186; data[i + 2] = 0; }
      else if (quadrant === 2) { data[i] = 0; data[i + 1] = 164; data[i + 2] = 239; }
      else { data[i] = 255; data[i + 1] = 185; data[i + 2] = 0; }
      data[i + 3] = 255;
    }
    expect(isMonotoneLetterPlaceholder(data)).toBe(false);
  });

  // WHY: A multi-color gradient has many colors -- should never trigger.
  it('does NOT flag a multi-color gradient', () => {
    const data = gradientPixels(16, 16);
    expect(isMonotoneLetterPlaceholder(data)).toBe(false);
  });

  // WHY: A pure white image is achromatic but pure white (brightness 255)
  // exceeds the brightness ceiling of 240. Only light-grey in [200, 240] triggers.
  it('does NOT flag a pure white image', () => {
    const data = solidPixels(16, 16, 255, 255, 255);
    expect(isMonotoneLetterPlaceholder(data)).toBe(false);
  });

  // WHY: Fully transparent has no opaque pixels, cannot be classified.
  it('does NOT flag a fully transparent image', () => {
    const data = solidPixels(16, 16, 226, 226, 226, 0);
    expect(isMonotoneLetterPlaceholder(data)).toBe(false);
  });

  // -- Grey-logo regression tests (Rule 9 gap: brightness band hardening) --------
  // These verify that real monochrome-grey brand logos are NOT mistaken for IH
  // letter-tiles. The brightness band [200, 240] must let dark/mid grey escape.

  // WHY: Apple's silver logo uses rgb(153,153,158). This is a real monochrome-grey
  // brand logo (brightness ~155) that must not be mistaken for an IH placeholder.
  // With the old [80, 240] band it would have been false-rejected.
  it('does NOT flag Apple-silver-like monochrome grey logo (brightness ~155)', () => {
    // ~92% silver dominant + ~8% anti-alias edge
    const data = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < data.length; i += 4) {
      const pixelIndex = i / 4;
      if (pixelIndex < 236) {
        data[i] = 153; data[i + 1] = 153; data[i + 2] = 158; // Apple silver
      } else {
        data[i] = 180; data[i + 1] = 180; data[i + 2] = 183; // anti-alias
      }
      data[i + 3] = 255;
    }
    expect(isMonotoneLetterPlaceholder(data)).toBe(false);
  });

  // WHY: A grey "W" logo at rgb(170,170,170) is a real mid-grey brand mark
  // (brightness 170). Must not be flagged -- it falls below the brightness floor.
  it('does NOT flag mid-grey brand logo (brightness 170)', () => {
    const data = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < data.length; i += 4) {
      const pixelIndex = i / 4;
      if (pixelIndex < 232) {
        data[i] = 170; data[i + 1] = 170; data[i + 2] = 170;
      } else {
        data[i] = 200; data[i + 1] = 200; data[i + 2] = 200;
      }
      data[i + 3] = 255;
    }
    expect(isMonotoneLetterPlaceholder(data)).toBe(false);
  });

  // WHY: A dark-grey brand logo at rgb(85,85,85) (brightness 85) is well below
  // the light-grey floor. Must not be mistaken for a light-grey IH placeholder.
  it('does NOT flag dark-grey brand logo (brightness 85)', () => {
    const data = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < data.length; i += 4) {
      const pixelIndex = i / 4;
      if (pixelIndex < 230) {
        data[i] = 85; data[i + 1] = 85; data[i + 2] = 85;
      } else {
        data[i] = 120; data[i + 1] = 120; data[i + 2] = 120;
      }
      data[i + 3] = 255;
    }
    expect(isMonotoneLetterPlaceholder(data)).toBe(false);
  });

  // WHY: A warm-grey brand logo at rgb(195,190,185) (brightness ~190, spread 10)
  // is achromatic and near the boundary but below the brightness floor of 200.
  // Tests the lower edge of the safe zone -- this must be KEPT, not rejected.
  it('does NOT flag warm-grey logo near boundary (brightness ~190)', () => {
    const data = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < data.length; i += 4) {
      const pixelIndex = i / 4;
      if (pixelIndex < 232) {
        data[i] = 195; data[i + 1] = 190; data[i + 2] = 185; // warm grey
      } else {
        data[i] = 210; data[i + 1] = 205; data[i + 2] = 200; // lighter anti-alias
      }
      data[i + 3] = 255;
    }
    expect(isMonotoneLetterPlaceholder(data)).toBe(false);
  });

  // NOTE: The OffscreenCanvas 16x16 downscale path (where bilinear interpolation
  // may shift pixel ratios toward grey) is not testable in Vitest/Node since
  // OffscreenCanvas is unavailable. The canvas path is exercised live by the
  // extension in the service worker. The placeholder gate's decision logic is
  // deterministically tested in tests/unit/icons/placeholder-gate.test.ts.
});

// -- Constants tests ----------------------------------------------------------

describe('placeholder detection constants', () => {
  // WHY: These values are calibrated from real measurements and must be stable.
  // Changing them without re-calibrating risks false accepts or false rejects.
  it('placeholderMaxDistinctColors is conservative (>= measured placeholder max)', () => {
    // Measured: placeholders have 4-5 distinct colors
    expect(placeholderMaxDistinctColors).toBeGreaterThanOrEqual(5);
    expect(placeholderMaxDistinctColors).toBeLessThanOrEqual(8);
  });

  it('placeholderMinDominantRatio is below measured placeholder minimum', () => {
    // Measured: placeholders have 89-93% dominant ratio
    expect(placeholderMinDominantRatio).toBeLessThanOrEqual(0.9);
    expect(placeholderMinDominantRatio).toBeGreaterThanOrEqual(0.75);
  });

  it('placeholderMaxSaturation separates grey from saturated colors', () => {
    // Grey (226,226,226) has spread 0; red (255,0,51) has spread 255
    expect(placeholderMaxSaturation).toBeGreaterThanOrEqual(10);
    expect(placeholderMaxSaturation).toBeLessThanOrEqual(30);
  });

  // WHY: The brightness band must be narrow enough to catch IH's light-grey (~226)
  // while letting dark/mid grey logos (brightness 85-190) escape. If the floor drops
  // below 200 or the ceiling rises above 240, grey logos get false-rejected.
  it('brightness band is narrow around IH light-grey (~226)', () => {
    // Floor must be high enough to let mid-grey (170) and silver (155) escape
    expect(placeholderMinBrightness).toBeGreaterThanOrEqual(190);
    // Floor must be low enough to still catch IH's placeholder at ~226
    expect(placeholderMinBrightness).toBeLessThanOrEqual(210);
    // Ceiling must exclude pure white (255) but include IH grey (226)
    expect(placeholderMaxBrightness).toBeGreaterThanOrEqual(230);
    expect(placeholderMaxBrightness).toBeLessThanOrEqual(245);
  });
});
