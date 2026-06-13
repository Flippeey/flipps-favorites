/**
 * Tests for normalizeUploadedImage fit-mode canvas math.
 *
 * WHY: `normalizeUploadedImage` bakes the image into the stored dataUrl — the
 * fit mode must produce correctly sized draw rects so cover images truly fill
 * the 160px canvas and contain images keep their aspect ratio with padding.
 * These tests verify the pure math (`computeIconDrawRect`) without a DOM.
 */
import { describe, expect, it } from 'vitest';
import { computeIconDrawRect } from '@/newtab/lib/icon-helpers';

const CANVAS = 160;

describe('computeIconDrawRect — contain', () => {
  it('square input fills the canvas exactly', () => {
    const r = computeIconDrawRect(100, 100, CANVAS, 'contain');
    expect(r.width).toBe(CANVAS);
    expect(r.height).toBe(CANVAS);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('landscape input is letterboxed (padding on top and bottom)', () => {
    // 200×100 → scale = 160/200 = 0.8 → draw 160×80, centered vertically
    const r = computeIconDrawRect(200, 100, CANVAS, 'contain');
    expect(r.width).toBeCloseTo(CANVAS);
    expect(r.height).toBeCloseTo(80);
    // Centered: x=0, y=(160-80)/2=40
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(40);
    // Verify neither dimension overflows the canvas
    expect(r.width).toBeLessThanOrEqual(CANVAS);
    expect(r.height).toBeLessThanOrEqual(CANVAS);
  });

  it('portrait input is pillarboxed (padding on left and right)', () => {
    // 100×200 → scale = 160/200 = 0.8 → draw 80×160, centered horizontally
    const r = computeIconDrawRect(100, 200, CANVAS, 'contain');
    expect(r.width).toBeCloseTo(80);
    expect(r.height).toBeCloseTo(CANVAS);
    expect(r.x).toBeCloseTo(40);
    expect(r.y).toBeCloseTo(0);
    expect(r.width).toBeLessThanOrEqual(CANVAS);
    expect(r.height).toBeLessThanOrEqual(CANVAS);
  });
});

describe('computeIconDrawRect — cover', () => {
  it('square input fills the canvas exactly (same as contain)', () => {
    const r = computeIconDrawRect(100, 100, CANVAS, 'cover');
    expect(r.width).toBe(CANVAS);
    expect(r.height).toBe(CANVAS);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('landscape input overflows vertically, centered', () => {
    // 200×100 → scale = 160/100 = 1.6 → draw 320×160
    // Image is wider than canvas: overflow is clipped by canvas bounds.
    const r = computeIconDrawRect(200, 100, CANVAS, 'cover');
    expect(r.width).toBeCloseTo(320);
    expect(r.height).toBeCloseTo(CANVAS);
    // At least one dimension must equal CANVAS
    expect(r.height).toBeCloseTo(CANVAS);
    // The draw rect must overflow horizontally so clipping produces full coverage
    expect(r.width).toBeGreaterThan(CANVAS);
    // Centered: x = (160-320)/2 = -80
    expect(r.x).toBeCloseTo(-80);
    expect(r.y).toBeCloseTo(0);
  });

  it('portrait input overflows horizontally, centered', () => {
    // 100×200 → scale = 160/100 = 1.6 → draw 160×320
    const r = computeIconDrawRect(100, 200, CANVAS, 'cover');
    expect(r.width).toBeCloseTo(CANVAS);
    expect(r.height).toBeCloseTo(320);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(-80);
  });

  it('cover always fills at least one dimension of the canvas exactly', () => {
    for (const [w, h] of [[300, 100], [100, 300], [50, 50], [160, 80], [80, 160]]) {
      const r = computeIconDrawRect(w, h, CANVAS, 'cover');
      const fillsWidth = Math.abs(r.width - CANVAS) < 0.001;
      const fillsHeight = Math.abs(r.height - CANVAS) < 0.001;
      expect(fillsWidth || fillsHeight, `${w}×${h} must touch at least one edge`).toBe(true);
      // And neither dimension is smaller than the canvas (no padding for cover)
      expect(r.width).toBeGreaterThanOrEqual(CANVAS - 0.001);
      expect(r.height).toBeGreaterThanOrEqual(CANVAS - 0.001);
    }
  });
});

describe('computeIconDrawRect — contain vs cover difference', () => {
  it('contain produces smaller draw area than cover for non-square inputs', () => {
    const w = 300, h = 100;
    const contain = computeIconDrawRect(w, h, CANVAS, 'contain');
    const cover = computeIconDrawRect(w, h, CANVAS, 'cover');
    // cover scales more (max scale > min scale for non-square), so both dims are larger
    expect(cover.width).toBeGreaterThan(contain.width);
    expect(cover.height).toBeGreaterThan(contain.height);
  });
});
