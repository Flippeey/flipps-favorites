import type { AppSettings, BookmarkUsageRecord, IconOverrideRecord } from '../../shared/messages';
import {
  defaultSettings,
  deleteBookmarkUsageRecord,
  deleteIconOverrideRecord,
  readBookmarkUsageRecords,
  readIconOverrideRecords,
  readSettings,
  writeBookmarkUsageRecord,
  writeIconOverrideRecord,
  writeSettings,
} from '../../shared/storage';
import { invalidateIcon } from './messaging';

export const WORKSPACE_SCHEMA = 'flipps-workspace-transfer' as const;
export const WORKSPACE_SCHEMA_VERSION = 1;

export type WorkspaceImportMode = 'merge' | 'replace';

interface IconOverrideTransferRecord {
  bookmarkUrl: string;
  dataUrl: string;
  fileName: string;
  mimeType: string;
  updatedAt: number;
}

interface BookmarkUsageTransferRecord {
  bookmarkId: string;
  usedAt: number;
}

export interface WorkspaceExportPayload {
  schema: typeof WORKSPACE_SCHEMA;
  schemaVersion: number;
  exportedAt: number;
  settings: AppSettings;
  iconOverrides: IconOverrideTransferRecord[];
  bookmarkUsage: BookmarkUsageTransferRecord[];
}

export interface WorkspaceImportSummary {
  mode: WorkspaceImportMode;
  iconOverrideCount: number;
  bookmarkUsageCount: number;
  settings: AppSettings;
}

export async function buildWorkspaceExport(): Promise<WorkspaceExportPayload> {
  const [settings, overrideRecords, usageRecords] = await Promise.all([
    readSettings(),
    readIconOverrideRecords(),
    readBookmarkUsageRecords(),
  ]);

  return {
    schema: WORKSPACE_SCHEMA,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    exportedAt: Date.now(),
    settings,
    iconOverrides: Object.values(overrideRecords).map(toTransferOverride),
    bookmarkUsage: Object.values(usageRecords).map(toTransferUsage),
  };
}

export function downloadWorkspaceExport(payload: WorkspaceExportPayload, fileName?: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const dateSuffix = new Date(payload.exportedAt).toISOString().slice(0, 10);
  const finalName = fileName ?? `flipps-workspace-${dateSuffix}.json`;
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

export async function parseWorkspaceFile(file: File): Promise<WorkspaceExportPayload> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Import file is not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Import file has an invalid structure.');
  }

  const candidate = parsed as Partial<WorkspaceExportPayload>;
  if (candidate.schema !== WORKSPACE_SCHEMA) {
    throw new Error('Import file is not a Flipp’s Favorites workspace export.');
  }

  const iconOverrides = Array.isArray(candidate.iconOverrides)
    ? candidate.iconOverrides.map(normalizeOverride).filter((r): r is IconOverrideTransferRecord => r !== null)
    : [];
  const bookmarkUsage = Array.isArray(candidate.bookmarkUsage)
    ? candidate.bookmarkUsage.map(normalizeUsage).filter((r): r is BookmarkUsageTransferRecord => r !== null)
    : [];

  return {
    schema: WORKSPACE_SCHEMA,
    schemaVersion: typeof candidate.schemaVersion === 'number' ? candidate.schemaVersion : WORKSPACE_SCHEMA_VERSION,
    exportedAt: typeof candidate.exportedAt === 'number' ? candidate.exportedAt : Date.now(),
    settings: (candidate.settings && typeof candidate.settings === 'object'
      ? candidate.settings
      : {}) as AppSettings,
    iconOverrides,
    bookmarkUsage,
  };
}

export async function applyWorkspaceImport(
  payload: WorkspaceExportPayload,
  mode: WorkspaceImportMode,
): Promise<WorkspaceImportSummary> {
  const dedupedOverrides = dedupeByKey(payload.iconOverrides, r => r.bookmarkUrl, (a, b) => b.updatedAt - a.updatedAt);
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

  for (const record of dedupedOverrides) {
    const fullRecord: IconOverrideRecord = {
      overrideKey: `override:${record.bookmarkUrl}`,
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
    iconOverrideCount: dedupedOverrides.length,
    bookmarkUsageCount: dedupedUsage.length,
    settings: nextSettings,
  };
}

function toTransferOverride(record: IconOverrideRecord): IconOverrideTransferRecord {
  return {
    bookmarkUrl: record.bookmarkUrl,
    dataUrl: record.dataUrl,
    fileName: record.fileName,
    mimeType: record.mimeType,
    updatedAt: record.updatedAt,
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
