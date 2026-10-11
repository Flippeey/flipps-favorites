import type { BookmarkNode, FolderBinding, FolderLocator, FolderRootKind } from '@/shared/models';

// Finds this browser's own copy of a folder described by a FolderLocator.
// Bookmark ids are browser-local, so a folder is recognised by the kind of
// root it sits under, its path of titles below that root, and a sample of what
// it directly contains. Root titles are localized and never compared.

const isFolder = (node: BookmarkNode): boolean => Array.isArray(node.children);

const FINGERPRINT_SIZE = 16;
const MIN_SCORE = 0.6;
const MIN_LEAD = 0.2;
// A stored sample this large that shares nothing with a candidate rules it out.
const VETO_MIN_HASHES = 5;
const CONTENT_ONLY_MIN_HASHES = 3;
const CONTENT_ONLY_MIN_SHARED = 2;
// Browser import wizards add at most two wrapper levels (e.g. "Imported From
// Firefox / Other Bookmarks").
const MAX_DROPPED_LEVELS = 2;

const ROOT_KIND_BY_FOLDER_TYPE = new Map<string, FolderRootKind>([
  ['bookmarks-bar', 'toolbar'],
  ['other', 'other'],
  ['mobile', 'mobile'],
]);

const ROOT_KIND_BY_ID = new Map<string, FolderRootKind>([
  ['1', 'toolbar'],
  ['2', 'other'],
  ['3', 'mobile'],
  ['toolbar_____', 'toolbar'],
  ['unfiled_____', 'other'],
  ['menu________', 'menu'],
  ['mobile______', 'mobile'],
]);

// Where each root's content can land when another browser imports it.
const ROOT_ALIASES: Record<FolderRootKind, readonly FolderRootKind[]> = {
  toolbar: ['toolbar'],
  other: ['other', 'menu', 'mobile'],
  menu: ['menu', 'other'],
  mobile: ['mobile', 'other'],
  unknown: ['unknown'],
};

interface FolderEntry {
  node: BookmarkNode;
  rootKind: FolderRootKind;
  path: string[];
  hashes: Set<string>;
}

interface TreeIndex {
  folders: FolderEntry[];
  byId: Map<string, FolderEntry>;
  bookmarkIdsByUrl: Map<string, string[]>;
  urlById: Map<string, string>;
}

const indexCache = new WeakMap<BookmarkNode[], TreeIndex>();
const encoder = new TextEncoder();

export function rootKindOf(node: BookmarkNode): FolderRootKind {
  return (node.folderType ? ROOT_KIND_BY_FOLDER_TYPE.get(node.folderType) : undefined)
    ?? ROOT_KIND_BY_ID.get(node.id)
    ?? 'unknown';
}

// Lowercase scheme and host, no fragment, no trailing slash.
export function normalizeUrlForMatch(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = '';
    return parsed.href.replace(/\/+$/, '');
  } catch {
    return url.trim().replace(/#.*$/, '').replace(/\/+$/, '');
  }
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of encoder.encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const toHex = (value: number): string => value.toString(16).padStart(8, '0');

function childHashes(folder: BookmarkNode): number[] {
  const keys = (folder.children ?? []).map(child => (isFolder(child) ? `d:${child.title}` : normalizeUrlForMatch(child.url ?? '')));
  return [...new Set(keys.map(fnv1a))];
}

function indexTree(tree: BookmarkNode[]): TreeIndex {
  const cached = indexCache.get(tree);
  if (cached) return cached;
  const index: TreeIndex = { folders: [], byId: new Map(), bookmarkIdsByUrl: new Map(), urlById: new Map() };
  const visit = (node: BookmarkNode, rootKind: FolderRootKind, path: string[]): void => {
    const entry: FolderEntry = { node, rootKind, path, hashes: new Set(childHashes(node).map(toHex)) };
    index.folders.push(entry);
    index.byId.set(node.id, entry);
    for (const child of node.children ?? []) {
      if (isFolder(child)) {
        visit(child, rootKind, [...path, child.title]);
      } else if (child.url) {
        const url = normalizeUrlForMatch(child.url);
        index.urlById.set(child.id, url);
        index.bookmarkIdsByUrl.set(url, [...(index.bookmarkIdsByUrl.get(url) ?? []), child.id]);
      }
    }
  };
  for (const top of tree) {
    for (const root of top.children ?? []) {
      if (isFolder(root)) visit(root, rootKindOf(root), []);
    }
  }
  indexCache.set(tree, index);
  return index;
}

export function buildFolderLocator(tree: BookmarkNode[], folderId: string): FolderLocator | null {
  const entry = indexTree(tree).byId.get(folderId);
  if (!entry) return null;
  const fingerprint = childHashes(entry.node).sort((a, b) => a - b).slice(0, FINGERPRINT_SIZE).map(toHex);
  return { rootKind: entry.rootKind, path: entry.path, fingerprint };
}

// '' for a record without a locator, so a binding made before locators
// existed stays valid until the record gains one.
export function locatorHash(locator: FolderLocator | undefined): string {
  return locator ? toHex(fnv1a(JSON.stringify([locator.rootKind, locator.path, locator.fingerprint]))) : '';
}

export function folderExists(tree: BookmarkNode[], folderId: string): boolean {
  return indexTree(tree).byId.has(folderId);
}

// The one local bookmark with this URL; null when none or several have it.
export function uniqueBookmarkForUrl(tree: BookmarkNode[], url: string): string | null {
  const ids = indexTree(tree).bookmarkIdsByUrl.get(normalizeUrlForMatch(url)) ?? [];
  return ids.length === 1 ? ids[0] : null;
}

export function bookmarkUrl(tree: BookmarkNode[], bookmarkId: string): string | null {
  return indexTree(tree).urlById.get(bookmarkId) ?? null;
}

const samePath = (a: string[], b: string[]): boolean => a.length === b.length && a.every((title, i) => title === b[i]);

// One path equals the other once up to MAX_DROPPED_LEVELS leading folders are
// dropped from the longer one; either side may be the longer.
function pathsAlign(a: string[], b: string[]): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const dropped = longer.length - shorter.length;
  return shorter.length > 0 && dropped <= MAX_DROPPED_LEVELS && samePath(longer.slice(dropped), shorter);
}

export interface ResolveHints {
  // This browser's own binding for the record.
  binding?: FolderBinding;
  // The record's folder id from wherever it was made; only a hint here.
  hintId?: string;
  // Workspace name, for records made before locators existed.
  title?: string;
}

// Returns the local folder id, or null when the record must wait (nothing
// found, or more than one candidate that content can't tell apart).
export function resolveFolder(locator: FolderLocator | undefined, tree: BookmarkNode[], hints: ResolveHints = {}): string | null {
  const { folders, byId } = indexTree(tree);
  const { binding, hintId, title } = hints;
  // The user may rename, move or refill their own folder, so a binding made
  // here is trusted as long as the folder exists and the record still
  // describes the same folder.
  if (binding && byId.has(binding.localId) && binding.locatorHash === locatorHash(locator)) return binding.localId;
  if (!locator) {
    const named = title === undefined ? [] : folders.filter(f => f.node.title === title);
    return named.length === 1 ? named[0].node.id : null;
  }

  const stored = new Set(locator.fingerprint);
  const shared = (f: FolderEntry): number => [...stored].filter(hash => f.hashes.has(hash)).length;
  const score = (f: FolderEntry): number => (stored.size ? shared(f) / stored.size : 0);
  const allowed = (f: FolderEntry): boolean => stored.size < VETO_MIN_HASHES || shared(f) > 0;
  const pickByContent = (candidates: FolderEntry[]): FolderEntry | null => {
    const [best, runnerUp] = [...candidates].sort((a, b) => score(b) - score(a));
    const lead = score(best) - (runnerUp ? score(runnerUp) : 0);
    return score(best) >= MIN_SCORE && lead >= MIN_LEAD ? best : null;
  };

  const exactRoot = folders.filter(f => f.rootKind === locator.rootKind && samePath(f.path, locator.path));
  const aliasedRoot = folders.filter(f =>
    f.rootKind !== locator.rootKind && ROOT_ALIASES[locator.rootKind].includes(f.rootKind) && samePath(f.path, locator.path));
  // A root locator ([]) matches roots only (tier 1); a single title needs
  // content to agree.
  const isRoot = locator.path.length === 0;
  const shifted = isRoot ? [] : folders.filter(f =>
    pathsAlign(f.path, locator.path) && (Math.min(f.path.length, locator.path.length) > 1 || score(f) >= MIN_SCORE));

  if (hintId) {
    const hinted = byId.get(hintId);
    const confirmed = hinted && allowed(hinted)
      && (exactRoot.includes(hinted) || aliasedRoot.includes(hinted) || shifted.includes(hinted) || (!isRoot && score(hinted) >= MIN_SCORE));
    if (confirmed) return hintId;
  }

  for (const step of [exactRoot, aliasedRoot, shifted]) {
    const live = step.filter(allowed);
    if (live.length === 1) return live[0].node.id;
    if (live.length > 1) return pickByContent(live)?.node.id ?? null;
  }

  if (isRoot || stored.size < CONTENT_ONLY_MIN_HASHES) return null;
  const best = pickByContent(folders);
  return best && shared(best) >= CONTENT_ONLY_MIN_SHARED ? best.node.id : null;
}
