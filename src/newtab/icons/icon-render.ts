import type { ResolvedIcon } from '../../shared/messages';
import { getHostname } from '../bookmarks/bookmark-navigation';
import { escapeAttribute, escapeHtml } from '../../shared/html-escape';

const tileFaviconCssSize = 64;
const dockFaviconCssSize = 32;
const dialogFaviconCssSize = 96;
const maxFaviconRequestSize = 256;

export function renderIconPlaceholder(label: string): string {
  return `<span class="bookmark-icon-placeholder">${escapeHtml(getInitial(label))}</span>`;
}

export function renderResolvedIconMarkup(icon: ResolvedIcon): string {
  return `<img class="bookmark-icon-image" src="${escapeAttribute(icon.dataUrl)}" alt="" />`;
}

export function renderBookmarkVisualIcon(bookmarkUrl: string, _label: string, resolvedIcon: ResolvedIcon | undefined, variant: 'tile' | 'dock'): string {
  if (resolvedIcon && resolvedIcon.sourceKind !== 'generated') {
    return renderResolvedIconMarkup(resolvedIcon);
  }

  return renderFaviconIconMarkup(bookmarkUrl, variant);
}

export function getFaviconImageUrl(bookmarkUrl: string, variant: 'tile' | 'dock' | 'dialog' = 'tile'): string {
  return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(bookmarkUrl)}&sz=${String(getFaviconRequestSize(variant))}`;
}

export function renderFaviconIconMarkup(bookmarkUrl: string, variant: 'tile' | 'dock'): string {
  const className = variant === 'tile' ? 'bookmark-icon-image' : 'bookmark-icon-image bookmark-icon-image--dock';
  return `<img class="${className}" src="${escapeAttribute(getFaviconImageUrl(bookmarkUrl))}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
}

export function applyResolvedIcon(element: HTMLElement, icon: ResolvedIcon): void {
  const bookmarkUrl = element.dataset.iconUrl;
  if (icon.sourceKind === 'generated' && bookmarkUrl) {
    element.dataset.iconState = 'favicon';
    element.dataset.iconSource = 'favicon';
    element.innerHTML = renderFaviconIconMarkup(bookmarkUrl, element.classList.contains('tile-icon') ? 'tile' : 'dock');
    return;
  }

  element.dataset.iconState = icon.isFallback ? 'fallback' : 'resolved';
  element.dataset.iconSource = icon.sourceKind;
  element.innerHTML = renderResolvedIconMarkup(icon);
}

export function applyPendingIcon(element: HTMLElement): void {
  const bookmarkUrl = element.dataset.iconUrl;
  if (bookmarkUrl) {
    element.dataset.iconState = 'favicon';
    element.dataset.iconSource = 'favicon';
    element.innerHTML = renderFaviconIconMarkup(bookmarkUrl, element.classList.contains('tile-icon') ? 'tile' : 'dock');
    return;
  }

  element.dataset.iconState = 'pending';
  const fallbackLabel = element.dataset.iconPlaceholder || '•';
  element.innerHTML = `<span class="bookmark-icon-placeholder">${escapeHtml(fallbackLabel)}</span>`;
}

export function createBookmarkActionTitle(url: string, title?: string): string {
  return title || getHostname(url);
}

function getInitial(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed[0].toUpperCase() : '•';
}

function getFaviconRequestSize(variant: 'tile' | 'dock' | 'dialog'): number {
  const cssSize = variant === 'dock'
    ? dockFaviconCssSize
    : variant === 'dialog'
      ? dialogFaviconCssSize
      : tileFaviconCssSize;
  const devicePixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  const preferredSize = Math.ceil(cssSize * devicePixelRatio);
  const minimumSize = variant === 'dock' ? 64 : 128;
  return Math.min(maxFaviconRequestSize, Math.max(minimumSize, preferredSize));
}
