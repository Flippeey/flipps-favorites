export const messageTypes = {
  ping: 'app/ping',
  getSettings: 'settings/get',
  patchSettings: 'settings/patch',
  getBookmarkTree: 'bookmarks/get-tree',
  updateBookmark: 'bookmarks/update',
  removeBookmark: 'bookmarks/remove',
  getIcon: 'icons/get',
  searchIcons: 'icons/search',
  setIconOverride: 'icons/set-override',
  setIconOverrideFromUrl: 'icons/set-override-from-url',
  removeIconOverride: 'icons/remove-override',
  invalidateIcon: 'icons/invalidate',
} as const;

export type MessageType = (typeof messageTypes)[keyof typeof messageTypes];

export type SettingsSectionId = 'general' | 'appearance';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface AppSettings {
  themeMode: ThemeMode;
  accentColor: string;
  settingsSection: SettingsSectionId;
  rootFolderId: string;
  rememberLastFolder: boolean;
  openLinksInNewTab: boolean;
  showDock: boolean;
  dockFolderId: string;
  favoritesColumns: number;
  favoritesRows: number;
  favoritesColumnGap: number;
  favoritesRowGap: number;
  bookmarkTileWidth: number;
  bookmarkIconSize: number;
  showBookmarkIconBackground: boolean;
}

export interface BookmarkNode {
  id: string;
  parentId?: string;
  title: string;
  url?: string;
  children?: BookmarkNode[];
}

export type IconSourceKind = 'override' | 'favicon' | 'search' | 'generated';

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

export interface GetBookmarkTreeRequest {
  type: typeof messageTypes.getBookmarkTree;
}

export interface GetBookmarkTreeResponse {
  tree: BookmarkNode[];
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

export type AppRequest =
  | PingRequest
  | GetSettingsRequest
  | PatchSettingsRequest
  | GetBookmarkTreeRequest
  | UpdateBookmarkRequest
  | RemoveBookmarkRequest
  | GetIconRequest
  | SearchIconsRequest
  | SetIconOverrideRequest
  | SetIconOverrideFromUrlRequest
  | RemoveIconOverrideRequest
  | InvalidateIconRequest;

export type AppResponse =
  | PingResponse
  | GetSettingsResponse
  | PatchSettingsResponse
  | GetBookmarkTreeResponse
  | UpdateBookmarkResponse
  | RemoveBookmarkResponse
  | GetIconResponse
  | SearchIconsResponse
  | SetIconOverrideResponse
  | SetIconOverrideFromUrlResponse
  | RemoveIconOverrideResponse
  | InvalidateIconResponse;
