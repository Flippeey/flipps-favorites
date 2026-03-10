export const messageTypes = {
  ping: 'app/ping',
  getSettings: 'settings/get',
  patchSettings: 'settings/patch',
  getBookmarkTree: 'bookmarks/get-tree',
} as const;

export type MessageType = (typeof messageTypes)[keyof typeof messageTypes];

export type SettingsSectionId = 'general' | 'appearance' | 'advanced';
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
}

export interface BookmarkNode {
  id: string;
  parentId?: string;
  title: string;
  url?: string;
  children?: BookmarkNode[];
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

export type AppRequest =
  | PingRequest
  | GetSettingsRequest
  | PatchSettingsRequest
  | GetBookmarkTreeRequest;

export type AppResponse =
  | PingResponse
  | GetSettingsResponse
  | PatchSettingsResponse
  | GetBookmarkTreeResponse;
