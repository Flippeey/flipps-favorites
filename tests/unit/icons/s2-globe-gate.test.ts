import { describe, expect, it } from 'vitest';
import { matchesS2GlobeSignature, computeByteSignature } from '@/background/icons/s2-globe-gate';

/**
 * Google S2 generic-globe gate.
 *
 * WHY: Google S2 (`/s2/favicons?domain_url=...&sz=N`) returns a real, valid-looking
 * globe image for any domain it has no favicon for. The globe passes the existing
 * quality checks (opaque center, minimum edge) and gets cached, short-circuiting
 * the pipeline before Icon Horse and DDG ever run. A host with no real favicon
 * then permanently displays a generic globe instead of falling through to better
 * sources.
 *
 * Detection: At service-worker startup, probe S2 with a guaranteed-nonexistent
 * sentinel domain. The response IS the globe. Compute a cheap byte signature
 * (length + FNV-1a hash of the bytes). For each real S2 result, compare its
 * signature — if it matches the sentinel's, it is the globe and must be rejected.
 *
 * Tests below exercise the pure signature helpers with synthetic byte arrays,
 * matching the pattern in color-diversity.test.ts and icon-cache-policy.test.ts.
 */

// -- Helpers ------------------------------------------------------------------

/** Create a deterministic byte array that represents a "globe" response. */
function globeBytes(): Uint8Array {
  const bytes = new Uint8Array(1024);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = (i * 7 + 13) & 0xff;
  }
  return bytes;
}

/** Create a different byte array that represents a real favicon. */
function faviconBytes(): Uint8Array {
  const bytes = new Uint8Array(2048);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = (i * 3 + 97) & 0xff;
  }
  return bytes;
}

/** Create bytes that differ from the globe only in content, same length. */
function sameLengthDifferentContent(): Uint8Array {
  const bytes = new Uint8Array(1024);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = (i * 11 + 29) & 0xff;
  }
  return bytes;
}

// -- computeByteSignature tests -----------------------------------------------

describe('computeByteSignature', () => {
  // WHY: The signature must be deterministic — same input always yields the same
  // output. Without this property, comparing sentinel vs. real response is broken.
  it('returns the same signature for identical byte arrays', () => {
    const a = globeBytes();
    const b = globeBytes();
    const sigA = computeByteSignature(a);
    const sigB = computeByteSignature(b);
    expect(sigA).toEqual(sigB);
  });

  // WHY: Different byte content must produce different signatures, otherwise
  // every S2 response would match the globe and all favicons would be rejected.
  it('returns different signatures for different content', () => {
    const globe = computeByteSignature(globeBytes());
    const favicon = computeByteSignature(faviconBytes());
    expect(globe).not.toEqual(favicon);
  });

  // WHY: Length alone is not sufficient — two images with the same byte count
  // but different pixels (one globe, one real favicon) must be distinguishable.
  // The hash component of the signature handles this.
  it('distinguishes same-length arrays with different content', () => {
    const globe = computeByteSignature(globeBytes());
    const sameLen = computeByteSignature(sameLengthDifferentContent());
    expect(globe).not.toEqual(sameLen);
  });

  // WHY: An empty response (network error fallback, zero-byte body) must produce
  // a valid signature, not throw. The pipeline handles empty responses elsewhere,
  // but the signature helper must be safe.
  it('handles empty byte arrays without throwing', () => {
    const sig = computeByteSignature(new Uint8Array(0));
    expect(sig).toBeDefined();
    expect(sig.length).toBe(0);
    expect(typeof sig.hash).toBe('number');
  });

  // WHY: The signature must include BOTH length and hash. Length-only comparison
  // would false-match any same-size image. Hash-only comparison would work but
  // length provides an O(1) short-circuit to skip the hash comparison entirely
  // for the common case (different-sized images).
  it('signature contains both length and hash fields', () => {
    const sig = computeByteSignature(globeBytes());
    expect(typeof sig.length).toBe('number');
    expect(typeof sig.hash).toBe('number');
    expect(sig.length).toBe(1024);
  });
});

// -- matchesS2GlobeSignature tests --------------------------------------------

describe('matchesS2GlobeSignature', () => {
  // WHY: When S2 returns the exact same bytes as the sentinel probe (= the
  // generic globe), the gate must reject so the pipeline falls through to
  // Icon Horse / DDG. This is the core fix for the reported bug.
  it('returns true when candidate bytes match the sentinel globe', () => {
    const sentinel = computeByteSignature(globeBytes());
    const candidate = globeBytes(); // identical bytes = globe
    expect(matchesS2GlobeSignature(candidate, sentinel)).toBe(true);
  });

  // WHY: A real favicon (different bytes) must NOT be rejected. False positives
  // here would break S2 entirely — every domain with a real favicon would be
  // treated as having no icon.
  it('returns false when candidate bytes differ from the sentinel (real favicon)', () => {
    const sentinel = computeByteSignature(globeBytes());
    const candidate = faviconBytes();
    expect(matchesS2GlobeSignature(candidate, sentinel)).toBe(false);
  });

  // WHY: Same byte count, different content. The hash must catch this to prevent
  // false-matching a real favicon that happens to compress to the same size as
  // the globe image.
  it('returns false for same-length but different-content bytes', () => {
    const sentinel = computeByteSignature(globeBytes());
    const candidate = sameLengthDifferentContent();
    expect(matchesS2GlobeSignature(candidate, sentinel)).toBe(false);
  });

  // WHY: If the sentinel probe itself failed (no globe signature available),
  // passing null means "globe detection disabled" — all S2 results must be
  // accepted rather than rejected. Fail-open prevents a broken sentinel from
  // disabling S2 entirely.
  it('returns false (fail-open) when sentinel signature is null', () => {
    const candidate = globeBytes();
    expect(matchesS2GlobeSignature(candidate, null)).toBe(false);
  });
});
