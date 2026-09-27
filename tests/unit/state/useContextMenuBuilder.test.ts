/**
 * buildContextMenuItems (src/newtab/state/useContextMenuBuilder.ts) is a pure
 * function of a target node plus a small, grouped context object — it needs
 * no React runtime, so it's tested directly here rather than through the
 * `useContextMenuBuilder` hook. tests/specs/context-menu.spec.ts (Playwright)
 * still covers the fully integrated, real-right-click path.
 */
import { describe, expect, it, vi } from 'vitest';
import type { BookmarkNode, WorkspaceRecord } from '@/shared/messages';
import type { ContextMenuItem } from '@/newtab/components/ContextMenu';
import type { MarqueeSelection } from '@/newtab/interaction/useMarquee';

// useContextMenuBuilder imports lib/messaging.ts (openTab) and shared/browser.ts
// (extensionApi), both of which throw at module-eval time outside a real
// extension context (see handleCreateWorkspaceFromFolder.test.ts). Stub both —
// none of these tests exercise an actual browser call, only which item is wired
// to which ctx action.
vi.mock('@/newtab/lib/messaging', () => ({
  openTab: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/shared/browser', () => ({
  extensionApi: { windows: { create: vi.fn() } },
}));

import { buildContextMenuItems, type ContextMenuBuilderContext } from '@/newtab/state/useContextMenuBuilder';

const bmA: BookmarkNode = { id: 'bm-a', title: 'A', url: 'https://a.test', parentId: 'work' };
const bmB: BookmarkNode = { id: 'bm-b', title: 'B', url: 'https://b.test', parentId: 'sub' };
const bmRoot: BookmarkNode = { id: 'bm-root', title: 'Root bookmark', url: 'https://root.test', parentId: 'vroot' };
const subFolder: BookmarkNode = { id: 'sub', title: 'Sub', parentId: 'work', children: [bmB] };
const workFolder: BookmarkNode = { id: 'work', title: 'Work', parentId: 'vroot', children: [bmA, subFolder] };
const tree: BookmarkNode[] = [{ id: 'vroot', title: 'root', children: [workFolder, bmRoot] }];

const noSelection: MarqueeSelection = { ids: new Set(), scopeFolderId: '' };

function makeCtx(overrides: Partial<ContextMenuBuilderContext> = {}): ContextMenuBuilderContext {
  return {
    tree,
    workspaces: [],
    selection: noSelection,
    defaultParentId: () => 'vroot',
    pushToast: vi.fn(),
    item: {
      newBookmark: vi.fn(),
      newFolder: vi.fn(),
      addWorkspace: vi.fn(),
      openAppSettings: vi.fn(),
      pickFolder: vi.fn(),
      pickBookmark: vi.fn(),
      editBookmark: vi.fn(),
      renameFolder: vi.fn(),
      deleteBookmark: vi.fn(),
      openAllInTabs: vi.fn(),
    },
    move: {
      moveTo: vi.fn(),
      moveSelectionToNewFolder: vi.fn(),
    },
    deletion: {
      confirmDeleteFolder: vi.fn(),
      confirmDeleteBatch: vi.fn(),
    },
    workspaceFromFolder: {
      create: vi.fn(),
      onResult: vi.fn(),
    },
    ...overrides,
  };
}

function items(result: ContextMenuItem[]): ContextMenuItem[] {
  return result.filter(i => i.kind === 'item');
}

function findItem(result: ContextMenuItem[], label: string): ContextMenuItem {
  const found = items(result).find(i => i.label === label);
  if (!found) throw new Error(`No item labelled "${label}" among [${items(result).map(i => i.label).join(', ')}]`);
  return found;
}

describe('buildContextMenuItems — single bookmark', () => {
  it('wires each action to its ctx callback, with no multi-select or excluded ids', () => {
    const ctx = makeCtx();
    const result = buildContextMenuItems(bmA, null, ctx);

    findItem(result, 'Open').onClick?.();
    expect(ctx.item.pickBookmark).toHaveBeenCalledWith(bmA);

    findItem(result, 'Edit…').onClick?.();
    expect(ctx.item.editBookmark).toHaveBeenCalledWith(bmA);

    findItem(result, 'Move to…').onClick?.();
    expect(ctx.move.moveTo).toHaveBeenCalledWith(['bm-a'], undefined);

    findItem(result, 'Delete').onClick?.();
    expect(ctx.item.deleteBookmark).toHaveBeenCalledWith(bmA);

    // Not part of a multi-select, so there is no "move to new folder" item.
    expect(items(result).some(i => i.label?.startsWith('Move') && i.label.includes('new folder'))).toBe(false);
  });
});

describe('buildContextMenuItems — single folder', () => {
  it('offers folder actions and disables "Create workspace" when the folder is already a workspace root', () => {
    const workspaces: WorkspaceRecord[] = [{ id: 'ws-1', name: 'Work', rootFolderId: 'work' } as WorkspaceRecord];
    const ctx = makeCtx({ workspaces });
    const result = buildContextMenuItems(workFolder, null, ctx);

    findItem(result, 'Open folder').onClick?.();
    expect(ctx.item.pickFolder).toHaveBeenCalledWith(workFolder);

    // Only bm-a is a direct child bookmark — sub is a folder, so "Open all" counts 1.
    expect(findItem(result, 'Open all (1) in new tabs').disabled).toBe(false);

    const createWorkspaceItem = findItem(result, 'Create workspace');
    expect(createWorkspaceItem.disabled).toBe(true);
    expect(createWorkspaceItem.title).toBe('This folder is already a workspace root');

    findItem(result, 'Delete folder').onClick?.();
    expect(ctx.deletion.confirmDeleteFolder).toHaveBeenCalledWith(workFolder);

    // Move to… must exclude the folder itself AND its descendant folder (sub) —
    // dropping "work" into "sub" (or itself) would orphan it from the tree.
    findItem(result, 'Move to…').onClick?.();
    expect(ctx.move.moveTo).toHaveBeenCalledWith(['work'], new Set(['work', 'sub']));
  });

  it('disables "Create workspace" at the workspace cap, distinct from the already-a-root case', () => {
    const workspaces = Array.from({ length: 20 }, (_, i) => ({ id: `w${i}`, name: `W${i}`, rootFolderId: `r${i}` }) as WorkspaceRecord);
    const ctx = makeCtx({ workspaces });
    const result = buildContextMenuItems(subFolder, null, ctx);
    const createWorkspaceItem = findItem(result, 'Create workspace');
    expect(createWorkspaceItem.disabled).toBe(true);
    expect(createWorkspaceItem.title).toMatch(/limit reached/);
  });
});

describe('buildContextMenuItems — multi-select', () => {
  it('labels by selection count and routes delete through the batch confirm', () => {
    const selection: MarqueeSelection = { ids: new Set(['bm-a', 'bm-root']), scopeFolderId: 'vroot' };
    const ctx = makeCtx({ selection });
    const result = buildContextMenuItems(bmA, null, ctx);

    expect(findItem(result, 'Delete 2 items')).toBeDefined();
    findItem(result, 'Delete 2 items').onClick?.();
    expect(ctx.deletion.confirmDeleteBatch).toHaveBeenCalledWith(expect.arrayContaining(['bm-a', 'bm-root']));
    expect(ctx.item.deleteBookmark).not.toHaveBeenCalled();

    findItem(result, 'Move 2 to new folder…').onClick?.();
    expect(ctx.move.moveSelectionToNewFolder).toHaveBeenCalledWith(expect.arrayContaining(['bm-a', 'bm-root']));
  });

  // WHY: regression coverage for the selected-folders Move-to guard (a selected
  // folder must not be offered as its own destination, same as the single-folder
  // case), and for labelling "Open in new tabs" by bookmark count rather than
  // raw selection count when the selection mixes folders and bookmarks.
  it('excludes selected folders (and their descendants) from Move to…, and counts only bookmarks for open-in-tabs', () => {
    // Right-clicking the folder itself takes the single-folder branch (tested
    // above) regardless of selection — this guard only applies when the
    // right-clicked target is a bookmark that's part of a mixed selection.
    const selection: MarqueeSelection = { ids: new Set(['work', 'bm-root']), scopeFolderId: 'vroot' };
    const ctx = makeCtx({ selection });
    const result = buildContextMenuItems(bmRoot, null, ctx);

    findItem(result, 'Move to…').onClick?.();
    expect(ctx.move.moveTo).toHaveBeenCalledWith(
      expect.arrayContaining(['work', 'bm-root']),
      new Set(['work', 'sub']),
    );

    // 2 selected items, only 1 (bm-root) is a bookmark — mixed selection.
    expect(findItem(result, 'Open 1 bookmark in new tabs')).toBeDefined();
  });
});

describe('buildContextMenuItems — folder-in-section (sectionFolder, null target)', () => {
  it('scopes "Add bookmark/folder" to the section and labels them accordingly', () => {
    const ctx = makeCtx();
    const result = buildContextMenuItems(null, workFolder, ctx);

    findItem(result, 'Add bookmark in Work').onClick?.();
    expect(ctx.item.newBookmark).toHaveBeenCalledWith('work', 'Work');

    findItem(result, 'Add folder in Work').onClick?.();
    expect(ctx.item.newFolder).toHaveBeenCalledWith('work', 'Work');
  });
});

describe('buildContextMenuItems — null target, no section (empty canvas)', () => {
  it('falls back to defaultParentId and shows the unscoped labels plus Settings', () => {
    const ctx = makeCtx();
    const result = buildContextMenuItems(null, null, ctx);

    findItem(result, 'Add bookmark').onClick?.();
    expect(ctx.item.newBookmark).toHaveBeenCalledWith('vroot', undefined);

    findItem(result, 'Settings').onClick?.();
    expect(ctx.item.openAppSettings).toHaveBeenCalledWith();

    expect(items(result).some(i => i.label?.startsWith('Add bookmark in'))).toBe(false);
  });

  it('disables "Add workspace" at the workspace cap', () => {
    const workspaces = Array.from({ length: 20 }, (_, i) => ({ id: `w${i}`, name: `W${i}`, rootFolderId: `r${i}` }) as WorkspaceRecord);
    const ctx = makeCtx({ workspaces });
    const result = buildContextMenuItems(null, null, ctx);
    const addWorkspaceItem = findItem(result, 'Add workspace');
    expect(addWorkspaceItem.disabled).toBe(true);
    expect(addWorkspaceItem.title).toMatch(/limit reached/);
  });
});
