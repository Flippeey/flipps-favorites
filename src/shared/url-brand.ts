const REGISTRY_SLDS = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'ne', 'or']);
const GENERIC_SUBDOMAIN_RE = /^(?:www2?|m|mobile|app|apps|secure|login|account|accounts|signin|auth|my|portal|dashboard|web)\./i;
const PERSONAL_INFRA_TLDS = new Set(['local', 'lan', 'home', 'internal', 'intranet']);
const PERSONAL_INFRA_MARKERS = new Set(['local', 'lan', 'home', 'homelab', 'internal', 'intranet', 'lab']);

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
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    try {
      return new URL(`https://${url}`).hostname.toLowerCase() || null;
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
