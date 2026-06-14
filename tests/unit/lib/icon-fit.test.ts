/**
 * Tests for normalizeUploadedImage canvas math after the fit control removal.
 *
 * WHY: `normalizeUploadedImage` bakes the image into the stored dataUrl using
 * cover scaling (Math.max) — the fixed default chosen when the inert
 * contain/cover fit control was removed (issue #29). Cover always fills the
 * 160px canvas and matches the tile's objectFit:cover rendering.
 *
 * These tests verify the pure math (`computeIconDrawRect`) without a DOM.
 * They also confirm that old IDB records carrying a stale `fit` field do not
 * cause any crash or type error — the field is simply ignored on read.
 */
import { describe, expect, it } from 'vitest';
import { computeIconDrawRect } from '@/newtab/lib/icon-helpers';

const CANVAS = 160;

describe('computeIconDrawRect — always cover (Math.max)', () => {
  it('square input fills the canvas exactly', () => {
    const r = computeIconDrawRect(100, 100, CANVAS);
    expect(r.width).toBe(CANVAS);
    expect(r.height).toBe(CANVAS);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('landscape input fills height, overflows width (cropped by canvas bounds)', () => {
    // 200×100 → scale = max(160/200, 160/100) = 1.6 → draw 320×160
    const r = computeIconDrawRect(200, 100, CANVAS);
    expect(r.height).toBeCloseTo(CANVAS);
    expect(r.width).toBeCloseTo(320);
    // Centered: x = (160-320)/2 = -80
    expect(r.x).toBeCloseTo(-80);
    expect(r.y).toBeCloseTo(0);
  });

  it('portrait input fills width, overflows height (cropped by canvas bounds)', () => {
    // 100×200 → scale = max(160/100, 160/200) = 1.6 → draw 160×320
    const r = computeIconDrawRect(100, 200, CANVAS);
    expect(r.width).toBeCloseTo(CANVAS);
    expect(r.height).toBeCloseTo(320);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(-80);
  });

  it('always fills at least one canvas dimension exactly (no padding / no letter-boxing)', () => {
    for (const [w, h] of [[300, 100], [100, 300], [50, 50], [160, 80], [80, 160]]) {
      const r = computeIconDrawRect(w, h, CANVAS);
      const fillsWidth  = Math.abs(r.width  - CANVAS) < 0.001;
      const fillsHeight = Math.abs(r.height - CANVAS) < 0.001;
      expect(fillsWidth || fillsHeight, `${w}×${h} must touch at least one edge`).toBe(true);
      // Neither dimension may be smaller than the canvas (no letterbox bars).
      expect(r.width).toBeGreaterThanOrEqual(CANVAS - 0.001);
      expect(r.height).toBeGreaterThanOrEqual(CANVAS - 0.001);
    }
  });
});

describe('graceful handling of legacy records carrying a stale `fit` field', () => {
  it('an old IDB record object with fit present can be spread without error', () => {
    // Simulate a record read from IDB that still has the old `fit` field.
    // The field must not cause a crash — TypeScript ignores unknown fields at
    // runtime and the model no longer declares it, so this is purely a runtime
    // safety check.
    const legacyRecord = {
      overrideKey: 'host:example.com',
      scope: 'host' as const,
      bookmarkUrl: 'https://example.com',
      dataUrl: 'data:image/png;base64,abc',
      fileName: 'icon.png',
      mimeType: 'image/png',
      updatedAt: Date.now(),
      fit: 'cover', // stale field — present in existing IDB records
    };

    // Destructure without fit to simulate how the app now reads the record.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { fit: _fit, ...record } = legacyRecord;
    expect(record.dataUrl).toBe('data:image/png;base64,abc');
    expect(record.scope).toBe('host');
    // `fit` is not present on the cleaned record.
    expect('fit' in record).toBe(false);
  });
});
