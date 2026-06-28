/**
 * Self-calibrating gate for Google S2's generic world-globe placeholder.
 *
 * Google S2 (`/s2/favicons?domain_url=...&sz=N`) returns a fixed default globe
 * image for any domain it has no favicon for. The globe passes the existing
 * quality checks (opaque center, minimum edge) and would be cached as a real
 * favicon, short-circuiting the pipeline before Icon Horse and DDG ever run.
 *
 * Detection: on first use per service-worker lifetime, probe S2 with a
 * guaranteed-nonexistent sentinel domain (`.invalid` TLD per RFC 6761). The
 * response IS the globe. Compute a cheap byte signature (length + FNV-1a hash).
 * For each real S2 result, compare its signature to the sentinel's — if they
 * match, it is the generic globe and must be rejected.
 *
 * Fail-open: if the sentinel probe fails (network error, S2 outage), globe
 * detection is disabled for the session rather than blocking all S2 results.
 */

import { fetchWithTimeout } from './icon-image';
import { faviconProviderUrl, faviconRequestSize, s2TimeoutMs } from './icon-constants';
import { clampFaviconSize } from './icon-classify';

// -- Pure signature helpers (exported for unit testing) -----------------------

export interface ByteSignature {
  readonly length: number;
  readonly hash: number;
}

/**
 * Compute a cheap fingerprint of a byte array: length + FNV-1a 32-bit hash.
 * Length provides an O(1) short-circuit for the common case (different-sized
 * images); the hash catches same-length different-content collisions.
 */
export function computeByteSignature(bytes: Uint8Array): ByteSignature {
  // FNV-1a 32-bit
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return { length: bytes.length, hash: hash >>> 0 }; // unsigned 32-bit
}

/**
 * Compare candidate bytes against a known globe signature.
 * Returns true when the candidate IS the globe (should be rejected).
 * Fail-open: returns false when sentinelSignature is null (probe failed).
 */
export function matchesS2GlobeSignature(
  candidateBytes: Uint8Array,
  sentinelSignature: ByteSignature | null,
): boolean {
  if (!sentinelSignature) return false; // fail-open
  if (candidateBytes.length !== sentinelSignature.length) return false; // O(1) short-circuit
  const candidateSig = computeByteSignature(candidateBytes);
  return candidateSig.hash === sentinelSignature.hash;
}

// -- Memoized sentinel probe (one network call per SW lifetime) ---------------

let globeSignaturePromise: Promise<ByteSignature | null> | null = null;

/**
 * Fetch the S2 globe signature, memoized for the service-worker lifetime.
 * Uses the `.invalid` TLD (RFC 6761 — guaranteed to never resolve to a real
 * domain) so the response is always the generic globe placeholder.
 */
export function getS2GlobeSignature(): Promise<ByteSignature | null> {
  if (!globeSignaturePromise) {
    globeSignaturePromise = probeS2Sentinel();
  }
  return globeSignaturePromise;
}

async function probeS2Sentinel(): Promise<ByteSignature | null> {
  try {
    const sentinelDomain = 'ff-sentinel-probe.invalid';
    const sz = clampFaviconSize(faviconRequestSize);
    const url = `${faviconProviderUrl}?domain_url=${encodeURIComponent(`https://${sentinelDomain}`)}&sz=${String(sz)}`;
    const response = await fetchWithTimeout(url, s2TimeoutMs, { cache: 'no-store' });
    if (!response.ok) return null;
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length === 0) return null;
    return computeByteSignature(bytes);
  } catch {
    return null; // fail-open: probe failed, globe detection disabled this session
  }
}

/** Reset the memoized sentinel (for testing only). */
export function resetS2GlobeSignature(): void {
  globeSignaturePromise = null;
}
