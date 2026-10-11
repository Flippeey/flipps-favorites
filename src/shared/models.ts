// Shared domain models + unions. Single source of truth consumed by both the
// app (src/**) and the Playwright test suite (tests/**). Message contracts live
// in messages.ts, which re-exports everything here.

import type { IconOverrideScope } from './icon-scope';

export type ThemeMode = 'light' | 'dark' | 'system';
export type BackgroundFitMode = 'cover' | 'contain' | 'fill';
export type BackgroundPositionMode = 'center' | 'top' | 'bottom';
export type BookmarkSortMode = 'manual' | 'name' | 'lastUsed' | 'created';
export type SortDirection = 'asc' | 'desc';
export type LayoutPresetId = 'balanced' | 'compact' | 'spacious' | 'presentation' | 'custom';
export type ClockHourFormat = '12' | '24';
export type ViewMode = 'grid' | 'list';
export type FolderOpenMode = 'overlay' | 'page';
export type FolderCountBadgeMode = 'always' | 'hover';
export type TileShape = 'squircle' | 'rounded' | 'circle';
export type BackgroundMode = 'solid' | 'gradient' | 'wallpaper';
export type GradientStyle = 'top' | 'top-bottom' | 'bottom' | 'aurora' | 'mesh' | 'vignette';
export type BackgroundColorSource = 'accent' | 'custom';

// Where a folder sits and what it holds, so another browser can find its own
// copy of the folder. Carried by the sync payload; absent on older records.
export type FolderRootKind = 'toolbar' | 'other' | 'menu' | 'mobile' | 'unknown';

export interface FolderLocator {
  rootKind: FolderRootKind;
  path: string[];
  fingerprint: string[];
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  rootFolderId: string;
  // Last user edit (ms). Newest wins when two browsers disagree; absent = 0.
  updatedAt?: number;
  rootFolder?: FolderLocator;
  // Visual identity
  themeMode: ThemeMode;
  accentColor: string;
  backgroundMode: BackgroundMode;
  solidBackgroundColor: string;
  gradientStyle: GradientStyle;
  gradientColorSource: BackgroundColorSource;
  gradientCustomColor: string;
  gradientIntensity: number;
  backgroundOpacity: number;
  backgroundFitMode: BackgroundFitMode;
  backgroundPositionMode: BackgroundPositionMode;
  // Layout identity
  layoutPreset: LayoutPresetId;
  favoritesColumnGap: number;
  favoritesRowGap: number;
  bookmarkTileWidth: number;
  bookmarkIconSize: number;
  tileShape: TileShape;
  showTileLabels: boolean;
  // View + sort identity (per-workspace)
  folderMode: ViewMode;
  bookmarkSortMode: BookmarkSortMode;
  bookmarkSortDirection: SortDirection;
}

// This browser's link from a synced record to one of its own folders. Kept in
// storage.local only: two profiles sharing one account bind different ids.
export interface FolderBinding {
  localId: string;
  locatorHash: string;
  state: 'bound' | 'lost';
}

// How this browser sees a workspace's folder; absent when found here.
// waiting: never found here; lost: found before, since removed; unused: the
// user said the workspace isn't used in this browser.
export type WorkspaceFolderState = 'waiting' | 'lost' | 'unused';

// A workspace as this browser shows it: rootFolderId is the bound local
// folder, or '' with a folderState. Never written back to storage.
export interface WorkspaceView extends WorkspaceRecord {
  folderState?: WorkspaceFolderState;
}

export interface AppSettings {
  // Identity
  activeWorkspaceId: string;
  workspaceOrder: string[];
  // Global behaviour
  themeMode: ThemeMode;
  rememberLastFolder: boolean;
  openLinksInNewTab: boolean;
  // Dock
  showDock: boolean;
  autoHideDock: boolean;
  dockFolderId: string;
  // Clock
  showClock: boolean;
  clockHourFormat: ClockHourFormat;
  // Search bar
  showSearchBar: boolean;
  // Folder behaviour (global)
  folderOpenMode: FolderOpenMode;
  folderCountBadgeMode: FolderCountBadgeMode;
  // Last user edit per synced key (ms); a missing key reads as 0.
  settingsUpdatedAt?: SettingsStamps;
}

// Momentary or browser-local state: kept in storage.local, never synced,
// never stamped and never exported.
export const PER_BROWSER_SETTING_KEYS = ['activeWorkspaceId', 'dockFolderId'] as const;
export type PerBrowserSettingKey = typeof PER_BROWSER_SETTING_KEYS[number];
export type SyncedSettingKey = Exclude<keyof AppSettings, PerBrowserSettingKey | 'settingsUpdatedAt'>;
export type SyncedSettings = Pick<AppSettings, SyncedSettingKey>;
export type SettingsStamps = Partial<Record<SyncedSettingKey, number>>;

// Records that an item was deleted, so the deletion reaches other browsers.
// `key` is the workspace id, the icon overrideKey or the folder-icon syncId.
export type DeletionMarkerKind = 'workspace' | 'iconOverride' | 'folderIcon';

export interface DeletionMarker {
  kind: DeletionMarkerKind;
  key: string;
  deletedAt: number;
}

export interface BookmarkNode {
  id: string;
  parentId?: string;
  title: string;
  url?: string;
  dateAdded?: number;
  children?: BookmarkNode[];
  // Chrome 134+: which root a top-level folder is, and whether it is the
  // account-synced copy.
  folderType?: string;
  syncing?: boolean;
}

export interface BookmarkUsageRecord {
  bookmarkId: string;
  usedAt: number;
}

export type IconSourceKind = 'override' | 'origin' | 'iconhorse' | 'favicon' | 'search' | 'generated';

export type IconFetchErrorKind =
  | 'network'
  | 'http-status'
  | 'not-image'
  | 'too-small'
  | 'decode-fail'
  | 'unknown';

export class IconFetchError extends Error {
  readonly kind: IconFetchErrorKind;
  readonly httpStatus?: number;

  constructor(kind: IconFetchErrorKind, message: string, httpStatus?: number) {
    super(message);
    this.name = 'IconFetchError';
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

export interface AppErrorResponse {
  __error: {
    kind: IconFetchErrorKind;
    message: string;
    httpStatus?: number;
  };
}

// Settings-sync error taxonomy. Distinct from IconFetchErrorKind: sync
// errors are transport/server-condition oriented (no image-decode concerns),
// plus a client-side 'validation' kind for a bad pairing code.
export type SyncErrorKind =
  | 'offline'
  | 'network'
  | 'http-status'
  | 'payload-too-large'
  | 'rate-limited'
  | 'not-found'
  | 'validation'
  | 'unknown';

export class SyncFetchError extends Error {
  readonly kind: SyncErrorKind;
  readonly httpStatus?: number;

  constructor(kind: SyncErrorKind, message: string, httpStatus?: number) {
    super(message);
    this.name = 'SyncFetchError';
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

export interface SyncErrorResponse {
  __syncError: {
    kind: SyncErrorKind;
    message: string;
    httpStatus?: number;
  };
}

export interface ResolvedIcon {
  cacheKey: string;
  sourceKind: IconSourceKind;
  dataUrl: string;
  lastUpdated: number;
  isFallback: boolean;
}

export interface IconCacheRecord {
  cacheKey: string;
  bookmarkUrl: string;
  sourceKind: Exclude<IconSourceKind, 'override'>;
  dataUrl: string;
  mimeType: string;
  updatedAt: number;
  expiresAt?: number;
  pipelineVersion: string;
}

export interface IconOverrideRecord {
  // Storage key derived from scope: 'exact:<url>' | 'host:<hostname>' | 'domain:<root>'.
  overrideKey: string;
  scope: IconOverrideScope;
  // The URL the override was set from (kept for display/export even on broader scopes).
  bookmarkUrl: string;
  dataUrl: string;
  fileName: string;
  mimeType: string;
  updatedAt: number;
}

// Opt-in custom icon for a folder. Independent of the bookmark icon-override
// system (icon-scope.ts) — folders have no URL to scope by, so this is keyed
// directly by the folder's bookmark id. Absent = default rendering (favicon
// collage in grid, folder glyph in list) — zero-diff for existing users.
export interface FolderIconOverrideRecord {
  folderId: string;
  dataUrl: string;
  fileName?: string;
  mimeType: string;
  updatedAt: number;
  // Identity across browsers (folder ids are browser-local). Kept when the
  // icon is replaced; assigned on first sync for records that predate it.
  syncId?: string;
  locator?: FolderLocator;
}

export interface IconSearchCandidate {
  imageUrl: string;
  previewUrl: string;
  label: string;
  sourceKind: 'favicon' | 'search';
  sourcePageUrl?: string;
  // Reported dimensions from the image search provider. Used by the auto path
  // to pre-rank roughly-square candidates above wide/tall ones so the fetch
  // budget is spent on logo-shaped images first. Not used by the manual grid.
  width?: number;
  height?: number;
}
