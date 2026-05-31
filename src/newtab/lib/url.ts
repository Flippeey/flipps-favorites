// Ensure a bookmark URL has a scheme so window.open / navigation treats it as
// absolute. Bare hosts (e.g. "example.com") get https:// prepended.
export function normalizeBookmarkUrl(url: string): string {
  return url.startsWith('http') ? url : `https://${url}`;
}
