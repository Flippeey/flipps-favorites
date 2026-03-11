import type { AppSettings, BookmarkNode, IconSearchCandidate, ResolvedIcon } from '../shared/messages';
import { createAccentPickerState, type AccentPickerState, type GeneralSettingsSubpage } from '../settings';
import { resolveInitialFolderId, resolveInitialIconToolTarget, type BookmarkActionTarget } from './bookmark-navigation';

export interface AppState {
  settings: AppSettings;
  tree: BookmarkNode[];
  currentFolderId: string;
  drawerOpen: boolean;
  generalSubpage: GeneralSettingsSubpage;
  accentPicker: AccentPickerState;
  iconToolTargetUrl: string;
  iconToolStatus: string;
  clipboard: BookmarkClipboardState | null;
  contextMenu: ContextMenuState | null;
  iconDialog: IconDialogState;
  resolvedIcons: Record<string, ResolvedIcon>;
  selectedIds: string[];
  selectionAnchorId: string | null;
  selectionScope: SelectionScope | null;
  statusMessage: AppStatus | null;
}

export type BookmarkItemKind = 'bookmark' | 'folder';

export type SelectionSurface = 'grid' | 'dock';

export interface SelectionScope {
  surface: SelectionSurface;
  folderId: string;
}

export interface FolderActionTarget {
  id: string;
  title: string;
  parentId: string;
}

export interface SurfaceContextMenuTarget {
  id: string;
  title: string;
  surface: 'grid' | 'dock';
}

export interface BookmarkContextMenuState {
  kind: 'bookmark';
  x: number;
  y: number;
  target: BookmarkActionTarget;
}

export interface FolderContextMenuState {
  kind: 'folder';
  x: number;
  y: number;
  target: FolderActionTarget;
}

export interface SurfaceContextMenuState {
  kind: 'surface';
  x: number;
  y: number;
  target: SurfaceContextMenuTarget;
}

export interface SelectionContextMenuState {
  kind: 'selection';
  x: number;
  y: number;
  target: SelectionContextMenuTarget;
}

export type ContextMenuState = BookmarkContextMenuState | FolderContextMenuState | SurfaceContextMenuState | SelectionContextMenuState;

export interface SelectionContextMenuTarget {
  ids: string[];
  bookmarkCount: number;
  folderCount: number;
  scope: SelectionScope | null;
}

export interface BookmarkClipboardState {
  mode: 'copy' | 'cut';
  items: BookmarkNode[];
}

export interface AppStatus {
  message: string;
  kind: 'error' | 'success' | 'info';
}

export interface IconDialogState {
  open: boolean;
  target: BookmarkActionTarget | null;
  draftTitle: string;
  draftUrl: string;
  query: string;
  status: string;
  statusKind: 'error' | 'success' | 'info' | '';
  loading: boolean;
  results: IconSearchCandidate[];
  previewIcon: ResolvedIcon | null;
}

export function createInitialAppState(args: {
  settings: AppSettings;
  tree: BookmarkNode[];
  getLastFolder: () => string | null;
  getFolderIdFromHash: () => string | null;
}): AppState {
  const { settings, tree, getLastFolder, getFolderIdFromHash } = args;
  return {
    settings,
    tree,
    currentFolderId: resolveInitialFolderId(settings, tree, getLastFolder, getFolderIdFromHash),
    drawerOpen: false,
    generalSubpage: 'general',
    accentPicker: createAccentPickerState(settings.accentColor),
    iconToolTargetUrl: resolveInitialIconToolTarget(tree),
    iconToolStatus: '',
    clipboard: null,
    contextMenu: null,
    iconDialog: createClosedIconDialogState(),
    resolvedIcons: {},
    selectedIds: [],
    selectionAnchorId: null,
    selectionScope: null,
    statusMessage: null,
  };
}

export function createClosedIconDialogState(): IconDialogState {
  return {
    open: false,
    target: null,
    draftTitle: '',
    draftUrl: '',
    query: '',
    status: '',
    statusKind: '',
    loading: false,
    results: [],
    previewIcon: null,
  };
}