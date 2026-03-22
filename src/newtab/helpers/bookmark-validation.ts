export function isValidBookmarkUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Known second-level registry labels used in country-code TLDs (e.g. co.uk, com.au, org.uk)
const REGISTRY_SLDS = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'ne', 'or']);

export function getSearchName(url: string): string {
  try {
    // Strip www. and m. prefixes before splitting
    const hostname = new URL(url).hostname.replace(/^(?:www|m)\./, '');
    const parts = hostname.split('.');
    let name: string;
    if (parts.length >= 3 && REGISTRY_SLDS.has(parts[parts.length - 2])) {
      // e.g. pogdesign.co.uk → ['pogdesign','co','uk'] → 'pogdesign'
      name = parts[parts.length - 3] ?? '';
    } else if (parts.length >= 2) {
      // e.g. google.com → ['google','com'] → 'google'
      name = parts[parts.length - 2] ?? '';
    } else {
      name = parts[0] ?? '';
    }
    // Return empty string for very short results so callers can fall back to the bookmark title
    return name.length >= 3 ? name : '';
  } catch {
    return '';
  }
}
