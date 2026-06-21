// Scope model for icon overrides. An override can apply to exactly one bookmark
// URL, to every bookmark on the same host, or to every bookmark whose host shares
// the same registrable domain. Storage keys are derived here so the background
// resolver, the import/export path, and the UI all agree on them.

export type IconOverrideScope = 'exact' | 'host' | 'domain';

// Country-code second-level registries (co.uk, com.au, …) where the registrable
// domain is three labels, not two. Mirrors the set used by shared/url-brand.
const REGISTRY_SLDS = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'ne', 'or']);

export function getScopeHostname(bookmarkUrl: string): string | null {
  try {
    return new URL(bookmarkUrl).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

// dev.azure.com -> azure.com, shop.pogdesign.co.uk -> pogdesign.co.uk.
export function getRegistrableDomain(hostname: string | null): string | null {
  if (!hostname) return null;
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length < 2) return hostname || null;
  if (parts.length >= 3 && REGISTRY_SLDS.has(parts[parts.length - 2])) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

// The brand label of a registrable domain — the registrable domain with its
// public-suffix/TLD stripped. Used for cross-TLD same-brand detection
// (e.g. ing.nl → "ing", ing.com → "ing", pogdesign.co.uk → "pogdesign").
export function getRootLabel(registrableDomain: string | null): string | null {
  if (!registrableDomain) return null;
  const parts = registrableDomain.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  // For ccSLD registries (pogdesign.co.uk) the root label is the first part
  if (parts.length >= 3 && REGISTRY_SLDS.has(parts[parts.length - 2])) {
    return parts[0] || null;
  }
  // Standard 2-part domain (ing.nl, ing.com) — root label is the first part
  return parts[0] || null;
}

// Storage key for a new override record. Returns null when the URL has no usable
// host for the requested scope (callers fall back to exact).
export function getOverrideKeyForScope(bookmarkUrl: string, scope: IconOverrideScope): string | null {
  if (scope === 'exact') {
    return `exact:${bookmarkUrl}`;
  }
  const hostname = getScopeHostname(bookmarkUrl);
  if (!hostname) return null;
  if (scope === 'host') {
    return `host:${hostname}`;
  }
  const root = getRegistrableDomain(hostname);
  return root ? `domain:${root}` : null;
}

// Keys to try when resolving the override for a bookmark, most specific first.
export function getOverrideLookupKeys(bookmarkUrl: string): string[] {
  const keys = [`exact:${bookmarkUrl}`];
  const hostname = getScopeHostname(bookmarkUrl);
  if (hostname) {
    keys.push(`host:${hostname}`);
    const root = getRegistrableDomain(hostname);
    if (root) {
      keys.push(`domain:${root}`);
    }
  }
  return keys;
}

export function normalizeOverrideScope(value: unknown): IconOverrideScope {
  return value === 'host' || value === 'domain' ? value : 'exact';
}
