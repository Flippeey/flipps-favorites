import type { DeletionMarker, DeletionMarkerKind } from './models';
import {
  DELETION_MARKER_RETENTION_MS,
  MAX_ICON_DELETION_MARKERS,
  MAX_WORKSPACE_DELETION_MARKERS,
} from './constants';

const MAX_STAMP = 2 ** 52;

// A stamp is wall-clock ms. Anything else (missing, fractional, negative, huge,
// non-numeric) reads as 0 — the same check on every browser, so every browser
// picks the same winner from the same data.
export function readStamp(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_STAMP
    ? value
    : 0;
}

// A user edit always beats the version it replaced, even one stamped by a
// device whose clock runs ahead.
export function nextStamp(previous: unknown, now: number = Date.now()): number {
  return Math.max(now, readStamp(previous) + 1);
}

// Structural equality with key order ignored; `undefined` fields count as
// absent. Used to skip writes whose value is already stored.
export function sameValue(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const entries = Object.entries(raw as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    return Object.fromEntries(entries);
  });
}

export function markerId(kind: DeletionMarkerKind, key: string): string {
  return `${kind}\u0000${key}`;
}

export function normalizeDeletionMarker(value: unknown): DeletionMarker | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<DeletionMarker>;
  if (raw.kind !== 'workspace' && raw.kind !== 'iconOverride' && raw.kind !== 'folderIcon') return null;
  if (typeof raw.key !== 'string' || !raw.key) return null;
  return { kind: raw.kind, key: raw.key, deletedAt: readStamp(raw.deletedAt) };
}

// One marker per (kind, key) keeping the newest; drops markers past retention;
// keeps the newest within each storage bucket's cap. Output order is
// deterministic so equal inputs compare equal.
export function pruneDeletionMarkers(markers: DeletionMarker[], now: number): DeletionMarker[] {
  const byId = new Map<string, DeletionMarker>();
  for (const marker of markers) {
    const id = markerId(marker.kind, marker.key);
    const existing = byId.get(id);
    if (!existing || marker.deletedAt > existing.deletedAt) byId.set(id, marker);
  }
  const live = [...byId.values()]
    .filter(m => m.deletedAt + DELETION_MARKER_RETENTION_MS >= now)
    .sort((a, b) => b.deletedAt - a.deletedAt || compareText(markerId(a.kind, a.key), markerId(b.kind, b.key)));
  const workspace = live.filter(m => m.kind === 'workspace').slice(0, MAX_WORKSPACE_DELETION_MARKERS);
  const icons = live.filter(m => m.kind !== 'workspace').slice(0, MAX_ICON_DELETION_MARKERS);
  return [...workspace, ...icons];
}

export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Folder icons stored before they carried a syncId get a deterministic one,
// the same one a legacy payload's icon for that folder id gets.
export function legacyFolderIconSyncId(folderId: string): string {
  return `legacy:${folderId}`;
}
