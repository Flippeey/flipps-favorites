// Typed Locator helpers shared across specs. Each returns a Playwright Locator
// built from the DOM contract documented in .claude/conventions.md (data-*
// attributes + ff- class hooks) — query those, never ad-hoc CSS, so a markup
// refactor only touches this file.
import type { Locator, Page } from '@playwright/test';
import type { BookmarkSortMode, SortDirection } from '@/shared/models';

/** A bookmark/folder tile by its stable bookmark id. */
export function tileById(page: Page, id: string): Locator {
  return page.locator(`[data-item-id="${id}"]`);
}

/** All tiles within a selection scope (folder root), in DOM order. */
export function tilesInScope(page: Page, scopeFolderId: string): Locator {
  return page.locator(`[data-scope-folder-id="${scopeFolderId}"] [data-item-id]`);
}

/** The sort pill button in the top nav. */
export function sortPill(page: Page): Locator {
  return page.locator('.ff-sort .ff-pill');
}

const SORT_VALUE: Record<`${BookmarkSortMode}:${SortDirection}`, string> = {
  'manual:asc': 'manual',
  'manual:desc': 'manual',
  'name:asc': 'name:asc',
  'name:desc': 'name:desc',
  'lastUsed:asc': 'lastUsed:desc',
  'lastUsed:desc': 'lastUsed:desc',
  'created:asc': 'created:asc',
  'created:desc': 'created:desc',
};

/** A sort option in the open sort panel, by mode + direction. */
export function sortOption(page: Page, mode: BookmarkSortMode, direction: SortDirection): Locator {
  const value = SORT_VALUE[`${mode}:${direction}`];
  const labels: Record<string, string> = {
    manual: 'Manual',
    'name:asc': 'Name (A → Z)',
    'name:desc': 'Name (Z → A)',
    'lastUsed:desc': 'Last used',
    'created:desc': 'Date added (newest)',
    'created:asc': 'Date added (oldest)',
  };
  return page.locator('.ff-sort__option', { hasText: labels[value] });
}

/** A workspace tab in the top nav by workspace id. */
export function workspaceTab(page: Page, id: string): Locator {
  return page.locator(`[data-workspace-id="${id}"]`);
}

/** The open context menu. */
export function contextMenu(page: Page): Locator {
  return page.locator('.ff-ctx[role="menu"]');
}

/** The app shell root — carries data-theme / data-bg / data-tile-shape. */
export function appShell(page: Page): Locator {
  return page.locator('.ff-app');
}

/** An overlay breadcrumb by the folder id it links to. */
export function overlayCrumb(page: Page, folderId: string): Locator {
  return page.locator(`[data-overlay-crumb-id="${folderId}"]`);
}