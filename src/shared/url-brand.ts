const REGISTRY_SLDS = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'ne', 'or']);
const GENERIC_SUBDOMAIN_RE = /^(?:www2?|m|mobile|app|apps|secure|login|account|accounts|signin|auth|my|portal|dashboard|web)\./i;
const PERSONAL_INFRA_TLDS = new Set(['local', 'lan', 'home', 'internal', 'intranet']);
const PERSONAL_INFRA_MARKERS = new Set(['local', 'lan', 'home', 'homelab', 'internal', 'intranet', 'lab']);

export interface BrandInfo {
  brand: string;
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

export function extractBrandInfo(url: string): BrandInfo {
  const raw = safeHostname(url);
  if (!raw) return { brand: '', isPersonalInfra: false };

  const hostname = raw.replace(GENERIC_SUBDOMAIN_RE, '');
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length === 0) return { brand: '', isPersonalInfra: false };

  // service.local / jellyfin.homelab.lan
  if (parts.length >= 2 && PERSONAL_INFRA_TLDS.has(parts[parts.length - 1])) {
    return { brand: parts[0], isPersonalInfra: true };
  }

  // prowlarr.local.flippflix.com — marker in the middle
  if (
    parts.length >= 3 &&
    parts.slice(1, -1).some(seg => PERSONAL_INFRA_MARKERS.has(seg))
  ) {
    return { brand: parts[0], isPersonalInfra: true };
  }

  // pogdesign.co.uk
  if (parts.length >= 3 && REGISTRY_SLDS.has(parts[parts.length - 2])) {
    return { brand: parts[parts.length - 3] ?? '', isPersonalInfra: false };
  }

  // mail.google.com -> google
  if (parts.length >= 2) {
    return { brand: parts[parts.length - 2] ?? '', isPersonalInfra: false };
  }

  return { brand: parts[0] ?? '', isPersonalInfra: false };
}

export function getBrandName(url: string): string {
  const info = extractBrandInfo(url);
  return info.brand.length >= 3 ? info.brand : '';
}
