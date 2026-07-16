import type {
  AppSettings,
  BookmarkNode,
  BookmarkSortMode,
  BookmarkUsageRecord,
  IconOverrideRecord,
  SortDirection,
  ViewMode,
  WorkspaceRecord,
} from '@/shared/messages';
import {
  defaultSettings,
  defaultWorkspaceSettings,
  deleteBookmarkUsageRecord,
  deleteIconOverrideRecord,
  deleteWorkspace,
  readBookmarkUsageRecords,
  readIconOverrideRecords,
  readSettings,
  readWorkspaces,
  readWorkspaceWallpaper,
  removeWorkspaceWallpaper,
  writeBookmarkUsageRecord,
  writeIconOverrideRecord,
  writeSettings,
  writeWorkspace,
  writeWorkspaceWallpaper,
} from '@/shared/storage';
import { getOverrideKeyForScope, normalizeOverrideScope, type IconOverrideScope } from '@/shared/icon-scope';
import { MAX_IMPORT_DATA_URL_BYTES, MAX_WORKSPACES } from '@/shared/constants';
import { getBookmarkTree, invalidateIcon } from './messaging';
import { findFolder, isFolder } from './tree';

export const WORKSPACE_SCHEMA = 'flipps-workspace-transfer' as const;
// v3: per-workspace view/sort. v2 (and earlier) exports stored folderMode/
// bookmarkSortMode/bookmarkSortDirection as GLOBAL settings; on import they are
// upcast onto each WorkspaceRecord that lacks them (see legacyViewSortFromSettings).
export const WORKSPACE_SCHEMA_VERSION = 3;

export type WorkspaceImportMode = 'merge' | 'replace';

interface IconOverrideTransferRecord {
  bookmarkUrl: string;
  dataUrl: string;
  fileName: string;
  mimeType: string;
  updatedAt: number;
  // Absent in exports made before scoped overrides existed — treated as 'exact'.
  scope?: IconOverrideScope;
}

interface BookmarkUsageTransferRecord {
  bookmarkId: string;
  usedAt: number;
}

// Wallpapers are stored separately from WorkspaceRecord because they can be MBs of data URL.
// In transfer files we ship them as a sidecar map keyed by workspace id.
type WorkspaceWallpaperMap = Record<string, string>;

export interface WorkspaceExportPayload {
  schema: typeof WORKSPACE_SCHEMA;
  schemaVersion: number;
  exportedAt: number;
  settings: AppSettings;
  workspaces: WorkspaceRecord[];
  workspaceWallpapers: WorkspaceWallpaperMap;
  iconOverrides: IconOverrideTransferRecord[];
  bookmarkUsage: BookmarkUsageTransferRecord[];
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
  // Workspaces present in the backup but dropped before writing because
  // MAX_WORKSPACES was already reached (merge: existing + incoming; replace:
  // incoming alone). Never silently truncated — always reported here.
  workspaceSkippedCount: number;
  // Workspaces that were attempted but whose write() threw (e.g. quota
  // exceeded mid-loop). workspaceCount only reflects what actually persisted.
  workspaceFailedCount: number;
  iconOverrideCount: number;
  // Icon overrides dropped for exceeding MAX_IMPORT_DATA_URL_BYTES.
  iconOverrideSkippedCount: number;
  bookmarkUsageCount: number;
  settings: AppSettings;
}

export async function buildWorkspaceExport(): Promise<WorkspaceExportPayload> {
  const [settings, workspaces, overrideRecords, usageRecords] = await Promise.all([
    readSettings(),
    readWorkspaces(),
    readIconOverrideRecords(),
    readBookmarkUsageRecords(),
  ]);

  const wallpaperEntries = await Promise.all(
    workspaces
      .filter(ws => ws.backgroundMode === 'wallpaper')
      .map(async ws => [ws.id, await readWorkspaceWallpaper(ws.id)] as const),
  );
  const workspaceWallpapers: WorkspaceWallpaperMap = {};
  for (const [id, dataUrl] of wallpaperEntries) {
    if (dataUrl) workspaceWallpapers[id] = dataUrl;
  }

  return {
    schema: WORKSPACE_SCHEMA,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    exportedAt: Date.now(),
    settings,
    workspaces,
    workspaceWallpapers,
    iconOverrides: Object.values(overrideRecords).map(toTransferOverride),
    bookmarkUsage: Object.values(usageRecords).map(toTransferUsage),
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

  // Forward-compat guard: refuse a backup written by a newer extension version
  // rather than silently dropping fields we don't understand.
  if (rawSchemaVersion !== undefined && rawSchemaVersion > WORKSPACE_SCHEMA_VERSION) {
    throw new Error('Import file was made by a newer version of Flipp’s Favorites. Update the extension and try again.');
  }

  // v2 (and earlier / versionless) exports carried view + sort as GLOBAL
  // settings. Upcast them onto each record that lacks the per-workspace fields.
  // Read via Record<string, unknown> narrowing — AppSettings no longer types
  // these fields, so a typed property read would not compile.
  const isLegacy = rawSchemaVersion === undefined || rawSchemaVersion <= 2;
  const legacyViewSort = isLegacy ? legacyViewSortFromSettings(candidate.settings) : null;

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
  const bookmarkUsage = Array.isArray(candidate.bookmarkUsage)
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

  return {
    schema: WORKSPACE_SCHEMA,
    schemaVersion: rawSchemaVersion ?? WORKSPACE_SCHEMA_VERSION,
    exportedAt: typeof candidate.exportedAt === 'number' ? candidate.exportedAt : Date.now(),
    settings: (candidate.settings && typeof candidate.settings === 'object'
      ? candidate.settings
      : {}) as AppSettings,
    workspaces,
    workspaceWallpapers,
    iconOverrides,
    bookmarkUsage,
    skipped: { oversizedDataUrlCount },
  };
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

export async function applyWorkspaceImport(
  payload: ParsedWorkspaceImport,
  mode: WorkspaceImportMode,
): Promise<WorkspaceImportSummary> {
  // Records that differ only in scope are distinct (an exact override and a host
  // override for the same URL coexist), so dedupe on the derived storage key.
  const dedupedOverrides = dedupeByKey(
    payload.iconOverrides,
    r => getOverrideKeyForScope(r.bookmarkUrl, normalizeOverrideScope(r.scope)) ?? `exact:${r.bookmarkUrl}`,
    (a, b) => b.updatedAt - a.updatedAt,
  );
  const dedupedUsage = dedupeByKey(payload.bookmarkUsage, r => r.bookmarkId, (a, b) => b.usedAt - a.usedAt);

  if (mode === 'replace') {
    const [existingOverrides, existingUsage] = await Promise.all([
      readIconOverrideRecords(),
      readBookmarkUsageRecords(),
    ]);
    await Promise.all([
      ...Object.keys(existingOverrides).map(key => deleteIconOverrideRecord(key)),
      ...Object.keys(existingUsage).map(key => deleteBookmarkUsageRecord(key)),
    ]);
  }

  const settingsToWrite: Partial<AppSettings> = mode === 'replace'
    ? { ...defaultSettings, ...payload.settings }
    : payload.settings;
  const nextSettings = await writeSettings(settingsToWrite);

  // Cap the import at MAX_WORKSPACES so a large/crafted backup can't blow past
  // chrome.storage.sync's 100 KB total quota mid-loop. Merge mode must respect
  // workspaces that already exist (never exceed 20 total); replace mode caps
  // the incoming set on its own since the loop below always merges by id
  // (existing workspaces are never deleted, even in replace mode).
  const existingWorkspaces = await readWorkspaces();

  // Best-effort tree fetch for cross-browser folder re-matching + identity
  // dedupe below. A failed fetch must not fail the import — records then keep
  // their original pointers (the pre-rematch behavior).
  let rematchTree: BookmarkNode[] | null = null;
  try {
    rematchTree = await getBookmarkTree();
  } catch {
    rematchTree = null;
  }

  const plan = planIncomingWorkspaces(payload, existingWorkspaces, rematchTree, mode);
  const workspaceSkippedCount = plan.skippedCount;

  let workspaceLandedCount = 0;
  let workspaceFailedCount = 0;
  for (const { record, originalId } of plan.toWrite) {
    try {
      await writeWorkspace(record);
      // Wallpapers in the payload are keyed by the sender's workspace id —
      // look up by the ORIGINAL id, store under the (possibly adopted) final id.
      const wallpaper = payload.workspaceWallpapers[originalId];
      if (wallpaper) {
        await writeWorkspaceWallpaper(record.id, wallpaper);
      }
      workspaceLandedCount += 1;
    } catch {
      // Quota or other storage failure mid-loop: keep going so later
      // (smaller/valid) entries still get a chance, and report what failed
      // instead of throwing a generic error that hides partial success.
      workspaceFailedCount += 1;
    }
  }

  // Replace = mirror: local workspaces absent from the other browser's data
  // are removed. Safe only because the preview dialog listed these removals
  // by name before the user confirmed. Bookmarks are never touched — only
  // the workspace record and its wallpaper go.
  for (const removed of plan.removedInReplace) {
    try {
      await deleteWorkspace(removed.id);
      await removeWorkspaceWallpaper(removed.id);
    } catch {
      // A failed deletion leaves an extra tab behind — harmless compared to
      // failing the whole import halfway through.
    }
  }

  for (const record of dedupedOverrides) {
    const scope = normalizeOverrideScope(record.scope);
    const overrideKey = getOverrideKeyForScope(record.bookmarkUrl, scope) ?? `exact:${record.bookmarkUrl}`;
    const fullRecord: IconOverrideRecord = {
      overrideKey,
      scope: overrideKey.startsWith('exact:') ? 'exact' : scope,
      bookmarkUrl: record.bookmarkUrl,
      dataUrl: record.dataUrl,
      fileName: record.fileName,
      mimeType: record.mimeType,
      updatedAt: record.updatedAt,
    };
    await writeIconOverrideRecord(fullRecord);
  }

  for (const record of dedupedUsage) {
    const fullRecord: BookmarkUsageRecord = {
      bookmarkId: record.bookmarkId,
      usedAt: record.usedAt,
    };
    await writeBookmarkUsageRecord(fullRecord);
  }

  try {
    await invalidateIcon();
  } catch {
    // best-effort: cached icons will refresh on next page load anyway
  }

  return {
    mode,
    workspaceCount: workspaceLandedCount,
    workspaceSkippedCount,
    workspaceFailedCount,
    iconOverrideCount: dedupedOverrides.length,
    iconOverrideSkippedCount: payload.skipped.oversizedDataUrlCount,
    bookmarkUsageCount: dedupedUsage.length,
    settings: nextSettings,
  };
}

export interface SyncPreviewSummary {
  // Incoming workspaces that will appear as new tabs.
  newWorkspaceNames: string[];
  // Local workspaces the incoming data will update in place (same id, or
  // identity-deduped: same name + same resolved folder).
  updatedWorkspaceNames: string[];
  // Replace-mirror only: local workspaces absent from the incoming data,
  // which confirming will REMOVE. Always [] in merge mode.
  removedWorkspaceNames: string[];
  // Incoming workspaces that will be dropped by the MAX_WORKSPACES cap.
  workspaceSkippedCount: number;
  iconOverrideIncomingCount: number;
  // Replace mode wipes local overrides before applying; 0 in merge mode.
  iconOverrideRemovedCount: number;
  bookmarkUsageIncomingCount: number;
}

// Dry run of applyWorkspaceImport for the link-preview dialog: reports what
// WOULD change without writing anything. Uses the SAME planIncomingWorkspaces
// as apply, so the dialog can never disagree with what a confirm actually
// does — reads local state only, never the network (the payload was already
// pulled once and is held in memory by the caller).
export async function buildSyncPreview(
  payload: ParsedWorkspaceImport,
  mode: WorkspaceImportMode,
): Promise<SyncPreviewSummary> {
  const [existingWorkspaces, existingOverrides] = await Promise.all([
    readWorkspaces(),
    readIconOverrideRecords(),
  ]);

  let tree: BookmarkNode[] | null = null;
  try {
    tree = await getBookmarkTree();
  } catch {
    tree = null;
  }

  const plan = planIncomingWorkspaces(payload, existingWorkspaces, tree, mode);

  const dedupedOverrides = dedupeByKey(
    payload.iconOverrides,
    r => getOverrideKeyForScope(r.bookmarkUrl, normalizeOverrideScope(r.scope)) ?? `exact:${r.bookmarkUrl}`,
    (a, b) => b.updatedAt - a.updatedAt,
  );
  const dedupedUsage = dedupeByKey(payload.bookmarkUsage, r => r.bookmarkId, (a, b) => b.usedAt - a.usedAt);

  return {
    newWorkspaceNames: plan.toWrite.filter(r => r.isNew).map(r => r.record.name),
    updatedWorkspaceNames: plan.toWrite.filter(r => !r.isNew).map(r => r.record.name),
    removedWorkspaceNames: plan.removedInReplace.map(w => w.name),
    workspaceSkippedCount: plan.skippedCount,
    iconOverrideIncomingCount: dedupedOverrides.length,
    iconOverrideRemovedCount: mode === 'replace' ? Object.keys(existingOverrides).length : 0,
    bookmarkUsageIncomingCount: dedupedUsage.length,
  };
}

interface ResolvedIncomingWorkspace {
  // Post folder-rematch and identity-dedupe (id possibly adopted from a local match).
  record: WorkspaceRecord;
  // The sender's id, needed to look up payload.workspaceWallpapers entries.
  originalId: string;
  // Final id absent locally = appears as a new tab.
  isNew: boolean;
}

interface IncomingWorkspacePlan {
  toWrite: ResolvedIncomingWorkspace[];
  // Incoming records dropped by the MAX_WORKSPACES cap.
  skippedCount: number;
  // Replace-mirror only: local records absent from the incoming set, to delete.
  removedInReplace: WorkspaceRecord[];
}

// Single source of truth for how incoming workspace records land locally —
// used by BOTH applyWorkspaceImport and buildSyncPreview so the preview
// dialog can never promise something the apply doesn't do. Handles, in order:
// the MAX_WORKSPACES cap (merge counts existing records, replace caps the
// incoming set alone), cross-browser folder re-matching, identity dedupe,
// and (replace only) the mirror's removal set.
function planIncomingWorkspaces(
  payload: ParsedWorkspaceImport,
  existingWorkspaces: WorkspaceRecord[],
  tree: BookmarkNode[] | null,
  mode: WorkspaceImportMode,
): IncomingWorkspacePlan {
  const existingById = new Map(existingWorkspaces.map(w => [w.id, w]));
  const existingWorkspaceCount = mode === 'merge' ? existingWorkspaces.length : 0;
  const importSlots = Math.max(0, MAX_WORKSPACES - existingWorkspaceCount);
  const sliced = payload.workspaces.slice(0, importSlots);

  const toWrite: ResolvedIncomingWorkspace[] = [];
  for (const incoming of sliced) {
    let record = tree ? rematchRootFolder(incoming, tree, existingById) : incoming;
    if (!existingById.has(record.id)) {
      // Identity dedupe: an incoming workspace matching an existing one by
      // name + (re-matched) folder IS that workspace arriving under a foreign
      // id — adopt the local id so it updates in place instead of stacking a
      // duplicate same-name tab. Several local matches = ambiguous, skip the
      // dedupe (same single-match rule as folder re-matching).
      const matches = existingWorkspaces.filter(
        w => w.name === record.name && w.rootFolderId === record.rootFolderId,
      );
      if (matches.length === 1) {
        record = { ...record, id: matches[0].id };
      }
    }
    toWrite.push({ record, originalId: incoming.id, isNew: !existingById.has(record.id) });
  }

  const finalIds = new Set(toWrite.map(r => r.record.id));
  return {
    toWrite,
    skippedCount: payload.workspaces.length - sliced.length,
    removedInReplace: mode === 'replace' ? existingWorkspaces.filter(w => !finalIds.has(w.id)) : [],
  };
}

// Cross-browser workspace repair (#7): rootFolderId is a browser-local
// bookmark id, so a record imported from another browser or profile usually
// points at a folder that doesn't exist here. Best-effort, in order: keep a
// pointer that resolves; else keep the resolving pointer of the local record
// with the same id (an id collision must not clobber a working local link
// with a foreign one); else adopt the folder whose title uniquely equals the
// workspace name. No match or an ambiguous title leaves the record unchanged
// (it renders as unresolved, exactly as before this repair existed).
function rematchRootFolder(
  record: WorkspaceRecord,
  tree: BookmarkNode[],
  existingById: Map<string, WorkspaceRecord>,
): WorkspaceRecord {
  if (findFolder(tree, record.rootFolderId)) return record;
  const local = existingById.get(record.id);
  if (local && findFolder(tree, local.rootFolderId)) {
    return { ...record, rootFolderId: local.rootFolderId };
  }
  const titleMatches = collectFoldersByTitle(tree, record.name);
  if (titleMatches.length === 1) {
    return { ...record, rootFolderId: titleMatches[0].id };
  }
  return record;
}

function collectFoldersByTitle(tree: BookmarkNode[], title: string): BookmarkNode[] {
  const matches: BookmarkNode[] = [];
  const walk = (nodes: BookmarkNode[]): void => {
    for (const node of nodes) {
      if (!isFolder(node)) continue;
      if (node.title === title) matches.push(node);
      walk(node.children ?? []);
    }
  };
  walk(tree);
  return matches;
}

function toTransferOverride(record: IconOverrideRecord): IconOverrideTransferRecord {
  return {
    bookmarkUrl: record.bookmarkUrl,
    dataUrl: record.dataUrl,
    fileName: record.fileName,
    mimeType: record.mimeType,
    updatedAt: record.updatedAt,
    scope: normalizeOverrideScope(record.scope),
  };
}

function toTransferUsage(record: BookmarkUsageRecord): BookmarkUsageTransferRecord {
  return {
    bookmarkId: record.bookmarkId,
    usedAt: record.usedAt,
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

  const updatedAt = typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt)
    ? Math.max(0, Math.floor(candidate.updatedAt))
    : Date.now();

  return {
    bookmarkUrl: candidate.bookmarkUrl,
    dataUrl: candidate.dataUrl,
    fileName: candidate.fileName,
    mimeType: candidate.mimeType,
    updatedAt,
    scope: normalizeOverrideScope(candidate.scope),
  };
}

function normalizeUsage(value: unknown): BookmarkUsageTransferRecord | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<BookmarkUsageTransferRecord>;
  if (typeof candidate.bookmarkId !== 'string' || !candidate.bookmarkId.trim()) return null;
  const usedAt = typeof candidate.usedAt === 'number' && Number.isFinite(candidate.usedAt)
    ? Math.max(0, Math.floor(candidate.usedAt))
    : 0;
  if (usedAt === 0) return null;
  return { bookmarkId: candidate.bookmarkId, usedAt };
}

function normalizeWorkspace(value: unknown, legacyViewSort: LegacyViewSort | null): WorkspaceRecord | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<WorkspaceRecord> & Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) return null;
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) return null;
  if (typeof candidate.rootFolderId !== 'string' || !candidate.rootFolderId.trim()) return null;
  // Merge with defaults so any missing fields stay valid without trusting the file blindly.
  const merged = {
    ...defaultWorkspaceSettings,
    ...candidate,
    id: candidate.id,
    name: candidate.name,
    rootFolderId: candidate.rootFolderId,
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

function dedupeByKey<T>(items: T[], keyOf: (item: T) => string, compare: (a: T, b: T) => number): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    const existing = map.get(key);
    if (!existing || compare(item, existing) < 0) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}
