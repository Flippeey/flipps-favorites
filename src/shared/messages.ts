export const messageTypes = {
  ping: 'app/ping',
  getSettings: 'settings/get',
  patchSettings: 'settings/patch',
  openBookmarkManager: 'browser/open-bookmark-manager',
  getBookmarkTree: 'bookmarks/get-tree',
  createBookmark: 'bookmarks/create',
  moveBookmark: 'bookmarks/move',
  updateBookmark: 'bookmarks/update',
  removeBookmark: 'bookmarks/remove',
  getIcon: 'icons/get',
  searchIcons: 'icons/search',
  setIconOverride: 'icons/set-override',
  setIconOverrideFromUrl: 'icons/set-override-from-url',
  removeIconOverride: 'icons/remove-override',
  invalidateIcon: 'icons/invalidate',
  getBookmarkUsage: 'bookmarks/get-usage',
  recordBookmarkUse: 'bookmarks/record-use',
} as const;

export type MessageType = (typeof messageTypes)[keyof typeof messageTypes];

export type SettingsSectionId = 'general' | 'appearance' | 'backup' | 'help';
export type ThemeMode = 'light' | 'dark' | 'system';
export type BackgroundFitMode = 'cover' | 'contain' | 'fill';
export type BackgroundPositionMode = 'center' | 'top' | 'bottom';
export type BookmarkSortMode = 'manual' | 'name' | 'lastUsed' | 'created';
export type SortDirection = 'asc' | 'desc';
export type LayoutPresetId = 'balanced' | 'compact' | 'spacious' | 'presentation' | 'custom';
export type SearchScope = 'folder' | 'library';
export type ClockStyle = 'minimal' | 'standard' | 'full' | 'compact';
export type ClockPosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
export type ClockSize = 'small' | 'medium' | 'large' | 'x-large';
export type SearchBarPosition = 'left' | 'center' | 'right';
export type ClockHourFormat = '12' | '24';
export type FolderMode = 'tiles' | 'sections';
export type FolderOpenMode = 'overlay' | 'page';
export type TileShape = 'squircle' | 'rounded' | 'circle';
export type BackgroundMode = 'solid' | 'gradient' | 'wallpaper';
export type GradientStyle = 'top' | 'top-bottom' | 'aurora';

export interface AppSettings {
  themeMode: ThemeMode;
  accentColor: string;
  customBackgroundImage: string;
  backgroundOpacity: number;
  backgroundFitMode: BackgroundFitMode;
  backgroundPositionMode: BackgroundPositionMode;
  settingsSection: SettingsSectionId;
  rootFolderId: string;
  rememberLastFolder: boolean;
  openLinksInNewTab: boolean;
  showDock: boolean;
  autoHideDock: boolean;
  dockFolderId: string;
  bookmarkSortMode: BookmarkSortMode;
  bookmarkSortDirection: SortDirection;
  searchScope: SearchScope;
  favoritesColumns: number;
  favoritesRows: number;
  favoritesColumnGap: number;
  favoritesRowGap: number;
  bookmarkTileWidth: number;
  bookmarkIconSize: number;
  showBookmarkIconBackground: boolean;
  showAccentBackground: boolean;
  layoutPreset: LayoutPresetId;
  showClock: boolean;
  clockStyle: ClockStyle;
  clockPosition: ClockPosition;
  clockSize: ClockSize;
  clockHourFormat: ClockHourFormat;
  showSearchBar: boolean;
  searchBarPosition: SearchBarPosition;
  folderMode: FolderMode;
  folderOpenMode: FolderOpenMode;
  tileShape: TileShape;
  showTileLabels: boolean;
  backgroundMode: BackgroundMode;
  gradientStyle: GradientStyle;
}

export interface BookmarkSearchResult {
  node: BookmarkNode;
  folderPath: BookmarkNode[];
}

export interface BookmarkNode {
  id: string;
  parentId?: string;
  title: string;
  url?: string;
  dateAdded?: number;
  children?: BookmarkNode[];
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
  overrideKey: string;
  bookmarkUrl: string;
  dataUrl: string;
  fileName: string;
  mimeType: string;
  updatedAt: number;
}

export interface IconSearchCandidate {
  imageUrl: string;
  previewUrl: string;
  label: string;
  sourceKind: 'favicon' | 'search';
  sourcePageUrl?: string;
}

export interface PingRequest {
  type: typeof messageTypes.ping;
}

export interface PingResponse {
  ok: true;
  context: 'background';
}

export interface GetSettingsRequest {
  type: typeof messageTypes.getSettings;
}

export interface GetSettingsResponse {
  settings: AppSettings;
}

export interface PatchSettingsRequest {
  type: typeof messageTypes.patchSettings;
  patch: Partial<AppSettings>;
}

export interface PatchSettingsResponse {
  settings: AppSettings;
}

export interface OpenBookmarkManagerRequest {
  type: typeof messageTypes.openBookmarkManager;
}

export interface OpenBookmarkManagerResponse {
  ok: boolean;
  opened: boolean;
  message?: string;
}

export interface GetBookmarkTreeRequest {
  type: typeof messageTypes.getBookmarkTree;
}

export interface GetBookmarkTreeResponse {
  tree: BookmarkNode[];
}

export interface CreateBookmarkRequest {
  type: typeof messageTypes.createBookmark;
  parentId: string;
  title: string;
  url?: string;
  index?: number;
}

export interface CreateBookmarkResponse {
  bookmark: BookmarkNode;
}

export interface MoveBookmarkRequest {
  type: typeof messageTypes.moveBookmark;
  bookmarkId: string;
  parentId: string;
  index?: number;
}

export interface MoveBookmarkResponse {
  bookmark: BookmarkNode;
}

export interface UpdateBookmarkRequest {
  type: typeof messageTypes.updateBookmark;
  bookmarkId: string;
  changes: {
    title?: string;
    url?: string;
  };
}

export interface UpdateBookmarkResponse {
  bookmark: BookmarkNode;
}

export interface RemoveBookmarkRequest {
  type: typeof messageTypes.removeBookmark;
  bookmarkId: string;
  recursive?: boolean;
}

export interface RemoveBookmarkResponse {
  ok: true;
}

export interface GetIconRequest {
  type: typeof messageTypes.getIcon;
  bookmarkUrl: string;
  bookmarkTitle?: string;
}

export interface GetIconResponse {
  icon: ResolvedIcon;
}

export interface SearchIconsRequest {
  type: typeof messageTypes.searchIcons;
  query: string;
  bookmarkUrl?: string;
}

export interface SearchIconsResponse {
  candidates: IconSearchCandidate[];
}

export interface SetIconOverrideRequest {
  type: typeof messageTypes.setIconOverride;
  bookmarkUrl: string;
  bookmarkTitle?: string;
  dataUrl: string;
  fileName: string;
  mimeType: string;
}

export interface SetIconOverrideResponse {
  icon: ResolvedIcon;
}

export interface SetIconOverrideFromUrlRequest {
  type: typeof messageTypes.setIconOverrideFromUrl;
  bookmarkUrl: string;
  bookmarkTitle?: string;
  imageUrl: string;
  fallbackImageUrl?: string;
  fileName?: string;
}

export interface SetIconOverrideFromUrlResponse {
  icon: ResolvedIcon;
}

export interface RemoveIconOverrideRequest {
  type: typeof messageTypes.removeIconOverride;
  bookmarkUrl: string;
  bookmarkTitle?: string;
}

export interface RemoveIconOverrideResponse {
  icon: ResolvedIcon;
}

export interface InvalidateIconRequest {
  type: typeof messageTypes.invalidateIcon;
  bookmarkUrl?: string;
}

export interface InvalidateIconResponse {
  ok: true;
}

export interface GetBookmarkUsageRequest {
  type: typeof messageTypes.getBookmarkUsage;
}

export interface GetBookmarkUsageResponse {
  usage: Record<string, number>;
}

export interface RecordBookmarkUseRequest {
  type: typeof messageTypes.recordBookmarkUse;
  bookmarkId: string;
}

export interface RecordBookmarkUseResponse {
  ok: true;
  usedAt: number;
}

export type AppRequest =
  | PingRequest
  | GetSettingsRequest
  | PatchSettingsRequest
  | OpenBookmarkManagerRequest
  | GetBookmarkTreeRequest
  | CreateBookmarkRequest
  | MoveBookmarkRequest
  | UpdateBookmarkRequest
  | RemoveBookmarkRequest
  | GetIconRequest
  | SearchIconsRequest
  | SetIconOverrideRequest
  | SetIconOverrideFromUrlRequest
  | RemoveIconOverrideRequest
  | InvalidateIconRequest
  | GetBookmarkUsageRequest
  | RecordBookmarkUseRequest;

export type AppResponse =
  | PingResponse
  | GetSettingsResponse
  | PatchSettingsResponse
  | OpenBookmarkManagerResponse
  | GetBookmarkTreeResponse
  | CreateBookmarkResponse
  | MoveBookmarkResponse
  | UpdateBookmarkResponse
  | RemoveBookmarkResponse
  | GetIconResponse
  | SearchIconsResponse
  | SetIconOverrideResponse
  | SetIconOverrideFromUrlResponse
  | RemoveIconOverrideResponse
  | InvalidateIconResponse
  | GetBookmarkUsageResponse
  | RecordBookmarkUseResponse;
