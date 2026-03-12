export function openBookmark(url: string, openInNewTab: boolean): void {
  if (openInNewTab) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  window.location.assign(url);
}
