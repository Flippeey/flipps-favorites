import type { AppSettings, BookmarkNode, BookmarkUsageRecord, IconSearchCandidate, ResolvedIcon } from '../../shared/messages';
import type { OnboardingStatus } from '../../shared/storage';
import { createAccentPickerState, type AccentPickerState, type GeneralSettingsSubpage } from '../../settings';
import { deriveTreeState, type DerivedTreeState } from './derived-tree';
import { resolveInitialFolderId, resolveInitialIconToolTarget, type BookmarkActionTarget } from '../bookmarks/bookmark-navigation';

export interface SortDropdownState {
  x: number;
  y: number;
  width: number;
  openUpward: boolean;
}

export interface AppState {
  settings: AppSettings;
  tree: BookmarkNode[];
  derivedTree: DerivedTreeState;
  currentFolderId: string;
  drawerOpen: boolean;
  generalSubpage: GeneralSettingsSubpage;
  accentPicker: AccentPickerState;
  iconToolTargetUrl: string;
  iconToolStatus: string;
  searchDraft: string;
  searchQuery: string;
  bookmarkUsage: Record<string, BookmarkUsageRecord>;
  clipboard: BookmarkClipboardState | null;
  contextMenu: ContextMenuState | null;
  sortDropdown: SortDropdownState | null;
  bookmarkDialog: BookmarkDialogState;
  resolvedIcons: Record<string, ResolvedIcon>;
  selectedIds: string[];
  selectionAnchorId: string | null;
  selectionScope: SelectionScope | null;
  statusMessage: AppStatus | null;
  undoStack: UndoHistoryEntry[];
  redoStack: UndoHistoryEntry[];
  settingsFeedback: SettingsFeedbackState;
  onboarding: OnboardingState;
}

export type OnboardingStepId = 'welcome' | 'theme' | 'root-folder' | 'dock' | 'layout';

export interface OnboardingState {
  open: boolean;
  status: OnboardingStatus;
  stepIndex: number;
  steps: OnboardingStepId[];
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

export interface FolderOrderSnapshot {
  folderId: string;
  before: string[];
  after: string[];
}

export interface DeleteHistoryItem {
  parentId: string;
  index: number;
  node: BookmarkNode;
}

export interface DeleteHistoryEntry {
  kind: 'delete';
  label: string;
  items: DeleteHistoryItem[];
  activeRootIds: string[];
}

export interface MoveHistoryEntry {
  kind: 'move';
  label: string;
  snapshots: FolderOrderSnapshot[];
}

export type UndoHistoryEntry = DeleteHistoryEntry | MoveHistoryEntry;

export interface SettingsFeedbackState {
  status: 'idle' | 'saving' | 'saved' | 'error';
  message: string;
}

export interface AppStatus {
  message: string;
  kind: 'error' | 'success' | 'info';
}

export interface BookmarkDialogState {
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
  bookmarkUsage: Record<string, BookmarkUsageRecord>;
  onboardingStatus: OnboardingStatus;
  getLastFolder: () => string | null;
  getFolderIdFromHash: () => string | null;
}): AppState {
  const { settings, tree, bookmarkUsage, onboardingStatus, getLastFolder, getFolderIdFromHash } = args;
  const currentFolderId = resolveInitialFolderId(settings, tree, getLastFolder, getFolderIdFromHash);
  return {
    settings,
    tree,
    derivedTree: deriveTreeState(tree, settings, currentFolderId, '', bookmarkUsage),
    currentFolderId,
    drawerOpen: false,
    generalSubpage: 'general',
    accentPicker: createAccentPickerState(settings.accentColor),
    iconToolTargetUrl: resolveInitialIconToolTarget(tree),
    iconToolStatus: '',
    searchDraft: '',
    searchQuery: '',
    bookmarkUsage,
    clipboard: null,
    contextMenu: null,
    sortDropdown: null,
    bookmarkDialog: createClosedBookmarkDialogState(),
    resolvedIcons: {},
    selectedIds: [],
    selectionAnchorId: null,
    selectionScope: null,
    statusMessage: null,
    undoStack: [],
    redoStack: [],
    settingsFeedback: {
      status: 'idle',
      message: '',
    },
    onboarding: createOnboardingState(onboardingStatus),
  };
}

export function createClosedBookmarkDialogState(): BookmarkDialogState {
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

export function pushUndoEntry(state: AppState, entry: UndoHistoryEntry): void {
  state.undoStack.unshift(entry);
  state.redoStack = [];
}

function createOnboardingState(status: OnboardingStatus): OnboardingState {
  return {
    open: status === 'pending',
    status,
    stepIndex: 0,
    steps: ['welcome', 'theme', 'root-folder', 'dock', 'layout'],
  };
}