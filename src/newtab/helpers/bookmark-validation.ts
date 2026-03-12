export function isValidBookmarkUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getSearchName(url: string): string {
  try {
    const parts = new URL(url).hostname.replace(/^www\./, '').split('.');
    return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? '');
  } catch {
    return '';
  }
}
