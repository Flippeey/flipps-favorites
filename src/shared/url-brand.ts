// ---------------------------------------------------------------------------
// Minimal RFC 3492 punycode → unicode decoder (xn-- labels only).
// No Node `punycode` module — unavailable in MV3 service workers.
// ---------------------------------------------------------------------------

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function decodeDigit(cp: number): number {
  // a-z → 0-25, 0-9 → 26-35
  if (cp >= 0x61 && cp <= 0x7A) return cp - 0x61;
  if (cp >= 0x30 && cp <= 0x39) return cp - 0x30 + 26;
  return BASE; // invalid
}

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

/** Decode a single punycode-encoded string (the part after "xn--"). */
function decodePunycode(encoded: string): string {
  const output: number[] = [];
  const lastDelim = encoded.lastIndexOf('-');

  // Copy the basic (ASCII) portion
  for (let i = 0; i < (lastDelim > 0 ? lastDelim : 0); i++) {
    output.push(encoded.charCodeAt(i));
  }

  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;

  for (let idx = lastDelim > 0 ? lastDelim + 1 : 0; idx < encoded.length;) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (idx >= encoded.length) break;
      const digit = decodeDigit(encoded.charCodeAt(idx++));
      if (digit >= BASE) break;
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    const len = output.length + 1;
    bias = adapt(i - oldi, len, oldi === 0);
    n += Math.floor(i / len);
    i %= len;
    output.splice(i, 0, n);
    i++;
  }

  return String.fromCodePoint(...output);
}

/** Decode IDN hostname labels: convert any `xn--*` label to unicode. */
function decodeIdnHostname(hostname: string): string {
  return hostname
    .split('.')
    .map(label =>
      label.startsWith('xn--') ? decodePunycode(label.slice(4)) : label,
    )
    .join('.');
}

const REGISTRY_SLDS = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'ne', 'or']);
const GENERIC_SUBDOMAIN_RE = /^(?:www2?|m|mobile|app|apps|secure|login|account|accounts|signin|auth|my|portal|dashboard|web)\./i;
const PERSONAL_INFRA_TLDS = new Set(['local', 'lan', 'home', 'internal', 'intranet']);
const PERSONAL_INFRA_MARKERS = new Set(['local', 'lan', 'home', 'homelab', 'internal', 'intranet', 'lab']);

// Curated set of registrable-domain brand labels with a vanity marketing prefix
// (try/get/my/app/mijn/use/go) where the REAL brand name is the remainder.
// Entries are the raw domain-label (e.g. "tryphotino" from tryphotino.io).
// Used ONLY by buildBrandSearchQuery to improve DDG query relevance and by
// isDdgFirstHitRelevant to match brand tokens more accurately.
//
// A heuristic length-cutoff was tried first but mis-truncated real brands
// (applemusic→lemusic, goodreads→odreads, gopro→pro). A curated list is safe:
// every entry is a known vanity-prefixed SaaS domain. Add new entries as needed.
const VANITY_STRIP_ROOTS: ReadonlyMap<string, string> = new Map([
  ['tryphotino', 'photino'],
  ['getpostman', 'postman'],
  ['usefathom', 'fathom'],
  ['myshopify', 'shopify'],
  ['mijndomein', 'domein'],
  ['getbootstrap', 'bootstrap'],
  ['tryghost', 'ghost'],
  ['getsentry', 'sentry'],
  ['usepanda', 'panda'],
  ['tryretool', 'retool'],
]);

/**
 * If `brand` is a known vanity-prefixed root, returns the stripped brand.
 * Otherwise returns the brand unchanged. Used only in the DDG search/gate path.
 */
export function stripKnownVanityPrefix(brand: string): string {
  return VANITY_STRIP_ROOTS.get(brand) ?? brand;
}

export interface BrandInfo {
  brand: string;
  // A meaningful non-generic subdomain that sits left of the registrable brand
  // (e.g. 'drive' in drive.google.com). Empty when the host is a bare domain, the
  // subdomain is generic (www/m/app/login…), or the host is personal-infra.
  // Kept separate from `brand` so display/scoring keep using the root brand while
  // search queries can combine the two ('google drive').
  subdomain: string;
  isPersonalInfra: boolean;
}

function safeHostname(url: string): string | null {
  try {
    return decodeIdnHostname(new URL(url).hostname.toLowerCase()) || null;
  } catch {
    try {
      return decodeIdnHostname(new URL(`https://${url}`).hostname.toLowerCase()) || null;
    } catch {
      return null;
    }
  }
}

// The label immediately left of the registrable brand, if it is meaningful.
// Generic subdomains were already stripped from the front, so any remaining label
// here (drive, play, shop) carries brand intent. Empty when absent or equal to brand.
function subdomainAt(parts: string[], brandIndex: number): string {
  if (brandIndex < 1) return '';
  const label = parts[brandIndex - 1] ?? '';
  return label && label !== parts[brandIndex] ? label : '';
}

export function extractBrandInfo(url: string): BrandInfo {
  const raw = safeHostname(url);
  if (!raw) return { brand: '', subdomain: '', isPersonalInfra: false };

  const hostname = raw.replace(GENERIC_SUBDOMAIN_RE, '');
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length === 0) return { brand: '', subdomain: '', isPersonalInfra: false };

  // service.local / jellyfin.homelab.lan
  if (parts.length >= 2 && PERSONAL_INFRA_TLDS.has(parts[parts.length - 1])) {
    return { brand: parts[0], subdomain: '', isPersonalInfra: true };
  }

  // prowlarr.local.flippflix.com — marker in the middle
  if (
    parts.length >= 3 &&
    parts.slice(1, -1).some(seg => PERSONAL_INFRA_MARKERS.has(seg))
  ) {
    return { brand: parts[0], subdomain: '', isPersonalInfra: true };
  }

  // shop.pogdesign.co.uk -> brand pogdesign, subdomain shop
  if (parts.length >= 3 && REGISTRY_SLDS.has(parts[parts.length - 2])) {
    const brandIndex = parts.length - 3;
    return { brand: parts[brandIndex] ?? '', subdomain: subdomainAt(parts, brandIndex), isPersonalInfra: false };
  }

  // drive.google.com -> brand google, subdomain drive
  if (parts.length >= 2) {
    const brandIndex = parts.length - 2;
    return { brand: parts[brandIndex] ?? '', subdomain: subdomainAt(parts, brandIndex), isPersonalInfra: false };
  }

  return { brand: parts[0] ?? '', subdomain: '', isPersonalInfra: false };
}

export function getBrandName(url: string): string {
  const info = extractBrandInfo(url);
  return info.brand.length >= 3 ? info.brand : '';
}

// Single source of truth for the brand image-search query used by BOTH the
// auto-resolve pipeline (icon-providers) and the edit-dialog search seed.
// Combines the root brand with a meaningful subdomain so multi-tenant hosts
// resolve their own product ('google drive', 'google play') instead of the
// parent brand ('google'). Falls back to the hostname when brand extraction
// yields nothing.
export function buildBrandSearchQuery(url?: string): string {
  if (!url) return '';
  const { brand: rawBrand, subdomain, isPersonalInfra } = extractBrandInfo(url);
  if (rawBrand) {
    const brand = stripKnownVanityPrefix(rawBrand);
    return `${subdomain ? `${brand} ${subdomain}` : brand} logo`.trim();
  }

  const hostname = safeHostname(url)?.replace(/^www\./, '');
  if (!hostname) return '';
  if (isPersonalInfra) {
    const first = hostname.split('.')[0];
    return first ? `${first} logo`.trim() : '';
  }
  const parts = hostname.split('.');
  const core = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0];
  return `${core} logo`.trim();
}
