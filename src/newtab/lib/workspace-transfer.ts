import type {
  AppSettings,
  BookmarkNode,
  BookmarkSortMode,
  FolderLocator,
  FolderRootKind,
  SortDirection,
  SyncedSettings,
  ViewMode,
  WorkspaceRecord,
} from '@/shared/messages';
import {
  defaultSettings,
  defaultWorkspaceSettings,
  deleteBookmarkUsageRecord,
  deleteFolderIconOverride,
  deleteIconOverrideRecord,
  deletePendingFolderIcon,
  deleteWorkspace,
  normalizeSettings,
  readAllFolderIconOverrides,
  readBookmarkUsageRecords,
  readDeletionMarkers,
  readFolderBindings,
  readIconOverrideRecords,
  readOnboardingState,
  readPendingFolderIcons,
  readPendingUsage,
  readSettings,
  readWorkspaces,
  readWorkspaceWallpaper,
  removeWorkspaceWallpaper,
  syncedSettingKeys,
  updateFolderBindings,
  withoutPerBrowserSettings,
  writeBookmarkUsageRecord,
  writeDeletionMarkers,
  writeFolderIconOverride,
  writeIconOverrideRecord,
  writePendingFolderIcon,
  writePendingUsage,
  writeSettings,
  writeWorkspace,
  writeWorkspaceWallpaper,
} from '@/shared/storage';
import { normalizeOverrideScope } from '@/shared/icon-scope';
import { MAX_IMPORT_DATA_URL_BYTES } from '@/shared/constants';
import { legacyFolderIconSyncId, normalizeDeletionMarker, readStamp, sameValue } from '@/shared/sync-stamps';
import type { DeletionMarker } from '@/shared/models';
import { getBookmarkTree, invalidateIcon } from './messaging';
import {
  WORKSPACE_SCHEMA,
  WORKSPACE_SCHEMA_VERSION,
  planIncomingWorkspaces,
  recommendLinkMode,
  toFolderIconTransfer,
  toOverrideTransfer,
  type BookmarkUsageTransferRecord,
  type FolderIconTransferRecord,
  type IconOverrideTransferRecord,
  type ImportOrigin,
  type LocalSyncSnapshot,
  type SyncPlan,
  type WorkspaceExportPayload,
  type WorkspaceImportMode,
  type WorkspaceWallpaperMap,
} from './sync-merge';

export {
  WORKSPACE_SCHEMA,
  WORKSPACE_SCHEMA_VERSION,
  type ImportOrigin,
  type WorkspaceExportPayload,
  type WorkspaceImportMode,
} from './sync-merge';

// Thrown for a payload written by a newer extension version. The message
// suits file import; the sync UI shows its own copy for it.
export class WorkspaceSchemaTooNewError extends Error {
  constructor() {
    super('Import file was made by a newer version of Flipp’s Favorites. Update the extension and try again.');
    this.name = 'WorkspaceSchemaTooNewError';
  }
}

// Import-only counters for entries dropped while parsing an untrusted backup
// file. Kept separate from WorkspaceExportPayload's on-disk shape (which
// buildWorkspaceExport also produces) so export output never carries them.
export interface WorkspaceImportSkipCounts {
  /** Icon overrides / wallpaper entries dropped for exceeding MAX_IMPORT_DATA_URL_BYTES. */
  oversizedDataUrlCount: number;
}

export type ParsedWorkspaceImport = WorkspaceExportPayload & { skipped: WorkspaceImportSkipCounts };

export interface WorkspaceImportSummary {
  mode: WorkspaceImportMode;
  workspaceCount: number;
  // New workspaces not stored because this browser already holds
  // MAX_WORKSPACES; updates to existing ones never count. Always reported,
  // and a sync keeps them in the shared copy for browsers with room.
  workspaceSkippedCount: number;
  // Workspaces that were attempted but whose write() threw (e.g. quota
  // exceeded mid-loop). workspaceCount only reflects what actually persisted.
  workspaceFailedCount: number;
  iconOverrideCount: number;
  // Icon overrides dropped for exceeding MAX_IMPORT_DATA_URL_BYTES.
  iconOverrideSkippedCount: number;
  folderIconCount: number;
  bookmarkUsageCount: number;
  settings: AppSettings;
  // The merged shared copy a sync pushes.
  merged: WorkspaceExportPayload;
}

// File export: a snapshot with stamps, but without deletion markers,
// per-browser settings or usage history (a plaintext file must not hold a
// per-URL last-opened timeline).
export async function buildWorkspaceExport(): Promise<WorkspaceExportPayload> {
  const local = await readLocalSnapshot();
  const { settingsUpdatedAt, ...settings } = withoutPerBrowserSettings(local.settings);
  return {
    schema: WORKSPACE_SCHEMA,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    exportedAt: Date.now(),
    settings,
    settingsUpdatedAt: settingsUpdatedAt ?? {},
    workspaces: local.workspaces,
    workspaceWallpapers: local.wallpapers,
    iconOverrides: local.iconOverrides.map(toOverrideTransfer),
    folderIcons: [...local.folderIcons, ...local.pendingFolderIcons].map(toFolderIconTransfer),
    bookmarkUsage: [],
  };
}

export function downloadWorkspaceExport(payload: WorkspaceExportPayload, fileName?: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const dateSuffix = new Date(payload.exportedAt).toISOString().slice(0, 10);
  const finalName = fileName ?? `flipps-settings-${dateSuffix}.json`;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = finalName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function parseWorkspaceFile(file: File): Promise<ParsedWorkspaceImport> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Import file is not valid JSON.');
  }
  return normalizeWorkspaceExportPayload(parsed);
}

// Shared shape validation + normalization for a parsed (untrusted) export
// payload, used by both the file-import path (parseWorkspaceFile) and the
// settings-sync pull path (sync-now.ts), which receives the same shape
// decrypted from the server rather than read from a File. Both are import
// paths, so the result carries the import-only `skipped` counters.
export function normalizeWorkspaceExportPayload(parsed: unknown): ParsedWorkspaceImport {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Import file has an invalid structure.');
  }

  const candidate = parsed as Partial<WorkspaceExportPayload>;
  if (candidate.schema !== WORKSPACE_SCHEMA) {
    throw new Error('Import file is not a Flipp’s Favorites backup.');
  }

  // Capture the RAW version BEFORE defaulting: a missing version means a legacy
  // file (pre-v2 exports omitted it), so it must NOT be read as the current
  // constant — that would skip the v2→v3 view/sort upcast below.
  const rawSchemaVersion = typeof candidate.schemaVersion === 'number' ? candidate.schemaVersion : undefined;

  // Forward-compat guard: refuse a payload written by a newer extension version
  // rather than silently dropping fields we don't understand. Runs before any
  // sync push, so an older client never overwrites a newer shared copy.
  if (rawSchemaVersion !== undefined && rawSchemaVersion > WORKSPACE_SCHEMA_VERSION) {
    throw new WorkspaceSchemaTooNewError();
  }

  // v2 (and earlier / versionless) exports carried view + sort as GLOBAL
  // settings. Upcast them onto each record that lacks the per-workspace fields.
  // Read via Record<string, unknown> narrowing — AppSettings no longer types
  // these fields, so a typed property read would not compile.
  const isLegacy = rawSchemaVersion === undefined || rawSchemaVersion <= 2;
  const legacyViewSort = isLegacy ? legacyViewSortFromSettings(candidate.settings) : null;
  // Usage before v5 named bookmarks by browser-local id alone, which another
  // browser can't verify, so it is dropped.
  const carriesUsage = rawSchemaVersion !== undefined && rawSchemaVersion >= 5;

  let oversizedDataUrlCount = 0;

  const iconOverrides = Array.isArray(candidate.iconOverrides)
    ? candidate.iconOverrides
        .map(entry => {
          if (isOversizedDataUrlCandidate(entry)) {
            oversizedDataUrlCount += 1;
            return null;
          }
          return normalizeOverride(entry);
        })
        .filter((r): r is IconOverrideTransferRecord => r !== null)
    : [];
  // Absent in exports made before folder custom icons existed (schema <= 3) —
  // treated as an empty list, same pattern as the v2->v3 view/sort upcast above.
  const folderIcons = Array.isArray(candidate.folderIcons)
    ? candidate.folderIcons
        .map(entry => {
          if (isOversizedDataUrlCandidate(entry)) {
            oversizedDataUrlCount += 1;
            return null;
          }
          return normalizeFolderIcon(entry);
        })
        .filter((r): r is FolderIconTransferRecord => r !== null)
    : [];
  const bookmarkUsage = carriesUsage && Array.isArray(candidate.bookmarkUsage)
    ? candidate.bookmarkUsage.map(normalizeUsage).filter((r): r is BookmarkUsageTransferRecord => r !== null)
    : [];
  const workspaces = Array.isArray(candidate.workspaces)
    ? candidate.workspaces
        .map(ws => normalizeWorkspace(ws, legacyViewSort))
        .filter((r): r is WorkspaceRecord => r !== null)
    : [];
  const { map: workspaceWallpapers, skippedCount: wallpaperSkippedCount } =
    normalizeWallpaperMap(candidate.workspaceWallpapers);
  oversizedDataUrlCount += wallpaperSkippedCount;
  const deletions = Array.isArray(candidate.deletions)
    ? candidate.deletions.map(normalizeDeletionMarker).filter((m): m is DeletionMarker => m !== null)
    : [];

  return {
    schema: WORKSPACE_SCHEMA,
    schemaVersion: rawSchemaVersion ?? WORKSPACE_SCHEMA_VERSION,
    exportedAt: typeof candidate.exportedAt === 'number' ? candidate.exportedAt : Date.now(),
    settings: normalizeIncomingSettings(candidate.settings),
    settingsUpdatedAt: normalizeSettings({ settingsUpdatedAt: candidate.settingsUpdatedAt }).settingsUpdatedAt ?? {},
    workspaces,
    workspaceWallpapers,
    iconOverrides,
    folderIcons,
    bookmarkUsage,
    deletions,
    skipped: { oversizedDataUrlCount },
  };
}

// Keeps only synced keys whose value is valid; per-browser keys an older
// payload carries are ignored.
function normalizeIncomingSettings(value: unknown): Partial<SyncedSettings> {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const normalized = normalizeSettings(raw as Partial<AppSettings>);
  const out: Record<string, unknown> = {};
  for (const key of syncedSettingKeys) {
    if (key in raw && sameValue(raw[key], normalized[key])) out[key] = normalized[key];
  }
  return out as Partial<SyncedSettings>;
}

// True only when the entry has a plausible override shape AND a data URL that
// exceeds the size cap — used to separate "oversized" (reported) from
// "malformed" (silently dropped, existing behavior) in the skip count.
function isOversizedDataUrlCandidate(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<IconOverrideTransferRecord>;
  return typeof candidate.dataUrl === 'string' && exceedsDataUrlSizeCap(candidate.dataUrl);
}

function exceedsDataUrlSizeCap(dataUrl: string): boolean {
  // Data URLs are ASCII (base64 or percent-encoded), so string length is a
  // faithful stand-in for byte size — no need to decode.
  return dataUrl.length > MAX_IMPORT_DATA_URL_BYTES;
}

// Legacy global view/sort carried by v2-and-earlier exports. Each field is only
// set when the stored value passes its literal-union guard; missing/invalid
// fields stay undefined so the record falls back to defaults during normalize.
interface LegacyViewSort {
  folderMode?: ViewMode;
  bookmarkSortMode?: BookmarkSortMode;
  bookmarkSortDirection?: SortDirection;
}

function legacyViewSortFromSettings(settings: unknown): LegacyViewSort {
  if (!settings || typeof settings !== 'object') return {};
  const raw = settings as Record<string, unknown>;
  const out: LegacyViewSort = {};
  if (isViewMode(raw.folderMode)) out.folderMode = raw.folderMode;
  if (isBookmarkSortMode(raw.bookmarkSortMode)) out.bookmarkSortMode = raw.bookmarkSortMode;
  if (isSortDirection(raw.bookmarkSortDirection)) out.bookmarkSortDirection = raw.bookmarkSortDirection;
  return out;
}

// Local literal-union guards. Kept here (not imported from shared/storage) so
// the transfer normalizer stays self-contained and independent of the
// storage-side normalizeWorkspaceRecord.
function isViewMode(value: unknown): value is ViewMode {
  return value === 'grid' || value === 'list';
}

function isBookmarkSortMode(value: unknown): value is BookmarkSortMode {
  return value === 'manual' || value === 'name' || value === 'lastUsed' || value === 'created';
}

function isSortDirection(value: unknown): value is SortDirection {
  return value === 'asc' || value === 'desc';
}

async function readLocalSnapshot(): Promise<LocalSyncSnapshot> {
  const [settings, workspaces, overrides, folderIcons, usage, deletions, bindings, pendingFolderIcons, pendingUsage] = await Promise.all([
    readSettings(),
    readWorkspaces(),
    readIconOverrideRecords(),
    readAllFolderIconOverrides(),
    readBookmarkUsageRecords(),
    readDeletionMarkers(),
    readFolderBindings(),
    readPendingFolderIcons(),
    readPendingUsage(),
  ]);
  const wallpapers: WorkspaceWallpaperMap = {};
  for (const ws of workspaces.filter(w => w.backgroundMode === 'wallpaper')) {
    const dataUrl = await readWorkspaceWallpaper(ws.id);
    if (dataUrl) wallpapers[ws.id] = dataUrl;
  }
  return {
    settings,
    workspaces,
    wallpapers,
    iconOverrides: Object.values(overrides),
    folderIcons: Object.values(folderIcons),
    usage: Object.values(usage),
    deletions,
    bindings,
    pendingFolderIcons,
    pendingUsage,
  };
}

async function planFor(
  payload: WorkspaceExportPayload,
  mode: WorkspaceImportMode,
  origin: ImportOrigin,
): Promise<{ local: LocalSyncSnapshot; plan: SyncPlan }> {
  // Best-effort tree fetch for finding folders here and identity pairing. A
  // failed fetch must not fail the import: nothing new is placed, and the
  // next page load resolves what it can.
  let tree: BookmarkNode[] | null = null;
  const [local] = await Promise.all([
    readLocalSnapshot(),
    getBookmarkTree().then(nodes => { tree = nodes; }, (error: unknown) => {
      console.warn('Bookmark tree unavailable; imported items wait for their folders.', error);
    }),
  ]);
  const { settingsUpdatedAt: _stamps, ...defaults } = withoutPerBrowserSettings(defaultSettings);
  const plan = planIncomingWorkspaces(payload, local, { mode, origin, tree, now: Date.now(), defaults });
  return { local, plan };
}

// Executes the planner's result; decides nothing itself.
export async function applyWorkspaceImport(
  payload: ParsedWorkspaceImport,
  mode: WorkspaceImportMode,
  origin: ImportOrigin = 'file',
): Promise<WorkspaceImportSummary> {
  const { local, plan } = await planFor(payload, mode, origin);

  const activeRekey = plan.rekeys.find(k => k.from === local.settings.activeWorkspaceId);
  const settings = plan.settingsChanged || activeRekey
    ? await writeSettings({ ...plan.settings, ...(activeRekey ? { activeWorkspaceId: activeRekey.to } : {}) })
    : local.settings;

  let workspaceCount = 0;
  let workspaceFailedCount = 0;
  for (const record of plan.workspaceWrites) {
    try {
      await writeWorkspace(record);
      workspaceCount += 1;
    } catch (error) {
      // Quota or other storage failure mid-loop: keep going so later entries
      // still get a chance, and report what failed.
      workspaceFailedCount += 1;
      console.warn('Failed to store an imported workspace.', error);
    }
  }
  for (const { id, dataUrl } of plan.wallpaperWrites) {
    try {
      await writeWorkspaceWallpaper(id, dataUrl);
    } catch (error) {
      console.warn('Failed to store an imported wallpaper.', error);
    }
  }
  // Only the workspace record and its wallpaper go; bookmarks are never touched.
  for (const id of plan.workspaceDeletes) {
    try {
      await deleteWorkspace(id);
      await removeWorkspaceWallpaper(id);
    } catch (error) {
      console.warn('Failed to remove a workspace during import.', error);
    }
  }
  const deleted = new Set(plan.workspaceDeletes);
  await updateFolderBindings(current => ({
    ...Object.fromEntries(Object.entries(current).filter(([id]) => !deleted.has(id))),
    ...plan.bindingWrites,
  }));

  for (const record of plan.overrideWrites) await writeIconOverrideRecord(record);
  for (const key of plan.overrideDeletes) await deleteIconOverrideRecord(key);
  for (const record of plan.folderIconWrites) await writeFolderIconOverride(record);
  for (const folderId of plan.folderIconDeletes) await deleteFolderIconOverride(folderId);
  for (const record of plan.pendingFolderIconWrites) await writePendingFolderIcon(record);
  for (const syncId of plan.pendingFolderIconDeletes) await deletePendingFolderIcon(syncId);
  for (const record of plan.usageWrites) await writeBookmarkUsageRecord(record);
  for (const bookmarkId of plan.usageDeletes) await deleteBookmarkUsageRecord(bookmarkId);
  await writePendingUsage(plan.pendingUsage);
  await writeDeletionMarkers(plan.deletions);

  if (plan.overrideWrites.length || plan.overrideDeletes.length) {
    try {
      await invalidateIcon();
    } catch (error) {
      // Cached icons refresh on the next page load anyway.
      console.warn('Icon cache invalidation failed after import.', error);
    }
  }

  return {
    mode,
    workspaceCount,
    workspaceSkippedCount: plan.workspaceSkippedCount,
    workspaceFailedCount,
    iconOverrideCount: plan.overrideWrites.length,
    iconOverrideSkippedCount: payload.skipped.oversizedDataUrlCount,
    folderIconCount: plan.folderIconWrites.length + plan.pendingFolderIconWrites.length,
    bookmarkUsageCount: plan.usageWrites.length,
    settings,
    merged: plan.merged,
  };
}

export interface SyncPreviewSummary {
  // "This browser will get": incoming workspaces that appear as new tabs.
  newWorkspaceNames: string[];
  // Local workspaces the incoming data updates in place.
  updatedWorkspaceNames: string[];
  // Local workspaces confirming removes (deleted elsewhere, or absent from
  // the other browser's data under Replace).
  removedWorkspaceNames: string[];
  // "This browser will add": local workspaces Merge pushes to the others.
  outboundWorkspaceNames: string[];
  // New incoming workspaces beyond the MAX_WORKSPACES cap.
  workspaceSkippedCount: number;
  iconOverrideIncomingCount: number;
  iconOverrideRemovedCount: number;
  bookmarkUsageIncomingCount: number;
  folderIconIncomingCount: number;
  folderIconRemovedCount: number;
  // Replace only while this browser holds untouched onboarding output.
  recommendedMode: WorkspaceImportMode;
}

// Dry run of the link flow's apply: the SAME planner, so the dialog can never
// disagree with what a confirm does. Reads local state only, never the
// network (the payload was pulled once and is held in memory by the caller).
export async function buildSyncPreview(
  payload: ParsedWorkspaceImport,
  mode: WorkspaceImportMode,
): Promise<SyncPreviewSummary> {
  const [{ local, plan }, onboarding] = await Promise.all([planFor(payload, mode, 'sync'), readOnboardingState()]);
  return {
    newWorkspaceNames: plan.newWorkspaceNames,
    updatedWorkspaceNames: plan.updatedWorkspaceNames,
    removedWorkspaceNames: plan.removedWorkspaceNames,
    outboundWorkspaceNames: plan.outboundWorkspaceNames,
    workspaceSkippedCount: plan.workspaceSkippedCount,
    iconOverrideIncomingCount: plan.overrideWrites.length,
    iconOverrideRemovedCount: plan.overrideDeletes.length,
    bookmarkUsageIncomingCount: plan.usageWrites.length,
    folderIconIncomingCount: plan.folderIconWrites.length + plan.pendingFolderIconWrites.length,
    folderIconRemovedCount: plan.folderIconDeletes.length,
    recommendedMode: recommendLinkMode(local, onboarding.completedAt ?? onboarding.skippedAt),
  };
}

const ROOT_KINDS: readonly FolderRootKind[] = ['toolbar', 'other', 'menu', 'mobile', 'unknown'];

function normalizeLocator(value: unknown): FolderLocator | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<FolderLocator>;
  const isStrings = (list: unknown): list is string[] => Array.isArray(list) && list.every(item => typeof item === 'string');
  if (!ROOT_KINDS.includes(raw.rootKind as FolderRootKind) || !isStrings(raw.path) || !isStrings(raw.fingerprint)) return null;
  return { rootKind: raw.rootKind as FolderRootKind, path: raw.path, fingerprint: raw.fingerprint };
}

function normalizeFolderIcon(value: unknown): FolderIconTransferRecord | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<FolderIconTransferRecord>;
  if (typeof candidate.folderId !== 'string' || !candidate.folderId.trim()) return null;
  if (typeof candidate.dataUrl !== 'string' || !candidate.dataUrl.startsWith('data:image/')) return null;
  if (exceedsDataUrlSizeCap(candidate.dataUrl)) return null;
  if (typeof candidate.mimeType !== 'string' || !candidate.mimeType.startsWith('image/')) return null;
  const locator = normalizeLocator(candidate.locator);

  return {
    folderId: candidate.folderId,
    dataUrl: candidate.dataUrl,
    ...(typeof candidate.fileName === 'string' ? { fileName: candidate.fileName } : {}),
    mimeType: candidate.mimeType,
    updatedAt: readStamp(candidate.updatedAt),
    syncId: typeof candidate.syncId === 'string' && candidate.syncId
      ? candidate.syncId
      : legacyFolderIconSyncId(candidate.folderId),
    ...(locator ? { locator } : {}),
  };
}

function normalizeOverride(value: unknown): IconOverrideTransferRecord | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<IconOverrideTransferRecord>;
  if (typeof candidate.bookmarkUrl !== 'string' || !candidate.bookmarkUrl.trim()) return null;
  if (typeof candidate.dataUrl !== 'string' || !candidate.dataUrl.startsWith('data:image/')) return null;
  if (exceedsDataUrlSizeCap(candidate.dataUrl)) return null;
  if (typeof candidate.fileName !== 'string' || !candidate.fileName.trim()) return null;
  if (typeof candidate.mimeType !== 'string' || !candidate.mimeType.startsWith('image/')) return null;

  return {
    bookmarkUrl: candidate.bookmarkUrl,
    dataUrl: candidate.dataUrl,
    fileName: candidate.fileName,
    mimeType: candidate.mimeType,
    updatedAt: readStamp(candidate.updatedAt),
    scope: normalizeOverrideScope(candidate.scope),
  };
}

function normalizeUsage(value: unknown): BookmarkUsageTransferRecord | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<BookmarkUsageTransferRecord>;
  const bookmarkId = typeof candidate.bookmarkId === 'string' && candidate.bookmarkId.trim() ? candidate.bookmarkId : undefined;
  const url = typeof candidate.url === 'string' && candidate.url.trim() ? candidate.url : undefined;
  const usedAt = readStamp(candidate.usedAt);
  if ((!bookmarkId && !url) || usedAt === 0) return null;
  return { ...(bookmarkId ? { bookmarkId } : {}), ...(url ? { url } : {}), usedAt };
}

function normalizeWorkspace(value: unknown, legacyViewSort: LegacyViewSort | null): WorkspaceRecord | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<WorkspaceRecord> & Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) return null;
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) return null;
  if (typeof candidate.rootFolderId !== 'string' || !candidate.rootFolderId.trim()) return null;
  const { updatedAt: rawStamp, rootFolder: rawLocator, ...rest } = candidate;
  const updatedAt = readStamp(rawStamp);
  const rootFolder = normalizeLocator(rawLocator);
  // Merge with defaults so any missing fields stay valid without trusting the file blindly.
  const merged = {
    ...defaultWorkspaceSettings,
    ...rest,
    id: candidate.id,
    name: candidate.name,
    rootFolderId: candidate.rootFolderId,
    ...(updatedAt > 0 ? { updatedAt } : {}),
    ...(rootFolder ? { rootFolder } : {}),
  } as WorkspaceRecord;
  // Resolve view/sort with a clear precedence: an explicit, valid per-record
  // value (v3 files) > the legacy global upcast (v2 files) > the plain default.
  // legacyViewSort is null for v3+, so explicit values always pass through there.
  return {
    ...merged,
    folderMode: isViewMode(candidate.folderMode)
      ? candidate.folderMode
      : legacyViewSort?.folderMode ?? defaultWorkspaceSettings.folderMode,
    bookmarkSortMode: isBookmarkSortMode(candidate.bookmarkSortMode)
      ? candidate.bookmarkSortMode
      : legacyViewSort?.bookmarkSortMode ?? defaultWorkspaceSettings.bookmarkSortMode,
    bookmarkSortDirection: isSortDirection(candidate.bookmarkSortDirection)
      ? candidate.bookmarkSortDirection
      : legacyViewSort?.bookmarkSortDirection ?? defaultWorkspaceSettings.bookmarkSortDirection,
  };
}

function normalizeWallpaperMap(value: unknown): { map: WorkspaceWallpaperMap; skippedCount: number } {
  if (!value || typeof value !== 'object') return { map: {}, skippedCount: 0 };
  const map: WorkspaceWallpaperMap = {};
  let skippedCount = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'string' || !raw.startsWith('data:image/')) continue;
    if (exceedsDataUrlSizeCap(raw)) {
      skippedCount += 1;
      continue;
    }
    map[key] = raw;
  }
  return { map, skippedCount };
}
