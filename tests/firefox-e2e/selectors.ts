// Thin copy of the selector STRINGS from tests/fixtures/selectors.ts, adapted
// to return plain CSS strings (Puppeteer has no Locator equivalent — callers
// use page.$, page.$$, page.waitForSelector with these directly). Source of
// truth for the DOM contract stays .claude/conventions.md; keep in sync with
// tests/fixtures/selectors.ts by hand until Phase 3 evaluates a shared module.

/** A bookmark/folder tile by its stable bookmark id. */
export function tileByIdSelector(id: string): string {
  return `[data-item-id="${id}"]`;
}

/** All tiles within a selection scope (folder root). */
export function tilesInScopeSelector(scopeFolderId: string): string {
  return `[data-scope-folder-id="${scopeFolderId}"] [data-item-id]`;
}

/** A workspace tab in the top nav by workspace id. */
export function workspaceTabSelector(id: string): string {
  return `[data-workspace-id="${id}"]`;
}

/** The open context menu. */
export const CONTEXT_MENU = '.ff-ctx[role="menu"]';

/** Context menu item labels live in this child span. */
export const CONTEXT_MENU_ITEM = '.ff-ctx__item';

/** The app shell root — carries data-theme (on <html>) / data-bg / data-tile-shape. */
export const APP_SHELL = '.ff-app';

/** Any bookmark/folder tile. */
export const ANY_TILE = '[data-item-id]';
export const BOOKMARK_TILE = '[data-item-id][data-item-kind="bookmark"]';
export const FOLDER_TILE = '[data-item-id][data-item-kind="folder"]';

export const ONBOARDING_ROOT = '.ff-onboard';
export const MODAL_SCRIM = '.ff-modal-scrim';
export const DIALOG = '.ff-dialog';
export const DRAWER = '.ff-drawer';
export const DRAWER_NAV_ITEM = '.ff-drawer__navitem';
export const SEARCH_INPUT = '.ff-search input';
export const SEARCH_RESULTS = '#ff-search-results';
export const SEARCH_RESULT_ITEM = '.ff-results__item';
