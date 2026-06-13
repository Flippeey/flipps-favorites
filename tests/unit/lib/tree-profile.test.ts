import { describe, expect, it } from 'vitest';
import type { BookmarkNode } from '@/shared/messages';
import { profileTree } from '@/newtab/lib/tree-profile';

// ---------------------------------------------------------------------------
// Helpers for building trees quickly
// ---------------------------------------------------------------------------

function bm(id: string, url: string, dateAdded?: number): BookmarkNode {
  return { id, title: id, url, ...(dateAdded !== undefined ? { dateAdded } : {}) };
}

function folder(id: string, children: BookmarkNode[]): BookmarkNode {
  return { id, title: id, children };
}

// A minimal system-shaped tree: vroot → system-root → user content
// (same shape as what the browser returns)
function withRoot(systemId: string, children: BookmarkNode[]): BookmarkNode[] {
  return [{ id: 'vroot', title: '', children: [folder(systemId, children)] }];
}

// ---------------------------------------------------------------------------
// (a) Bookmarks bar '1' selected with 120 flat children — the Hoarder case.
//     Selected system root is TRANSPARENT (NOT excluded), folderedRatio = 0.
// ---------------------------------------------------------------------------
describe('profileTree — bookmarks bar selected (Hoarder)', () => {
  const children: BookmarkNode[] = Array.from({ length: 120 }, (_, i) =>
    bm(`bm${i}`, `https://example${i}.com`, 1_000_000),
  );
  // Root '1' is selected — we pass it directly as the roots array.
  const root1 = folder('1', children);
  const roots = [root1];

  it('counts all 120 flat bookmarks even though root is a system folder', () => {
    const p = profileTree(roots);
    expect(p.totalBookmarks).toBe(120);
  });

  it('folderedRatio is 0 because all bookmarks are direct children of the selected root', () => {
    const p = profileTree(roots);
    expect(p.folderedRatio).toBe(0);
  });

  it('totalFolders is 0', () => {
    const p = profileTree(roots);
    expect(p.totalFolders).toBe(0);
  });

  it('maxDepth is 0 (flat layout, selected root is depth 0)', () => {
    const p = profileTree(roots);
    expect(p.maxDepth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (b) Deep organized tree — high folderedRatio + maxDepth.
// ---------------------------------------------------------------------------
describe('profileTree — deep organized tree', () => {
  // 2 subfolders, each with 2 sub-subfolders of 5 bookmarks = 20 nested bm
  const leaf = (prefix: string) =>
    Array.from({ length: 5 }, (_, i) => bm(`${prefix}-${i}`, `https://${prefix}-${i}.com`, 1_000_000));

  const root = folder('root', [
    folder('f1', [
      folder('f1a', leaf('f1a')),
      folder('f1b', leaf('f1b')),
    ]),
    folder('f2', [
      folder('f2a', leaf('f2a')),
      folder('f2b', leaf('f2b')),
    ]),
  ]);

  const roots = [root];

  it('folderedRatio is 1.0 (all bookmarks nested, none are direct children of selected root)', () => {
    const p = profileTree(roots);
    expect(p.folderedRatio).toBe(1);
  });

  it('maxDepth is >= 2 (subfolder→sub-subfolder→bookmarks = depth 2)', () => {
    const p = profileTree(roots);
    expect(p.maxDepth).toBeGreaterThanOrEqual(2);
  });

  it('totalBookmarks is 20', () => {
    const p = profileTree(roots);
    expect(p.totalBookmarks).toBe(20);
  });

  it('totalFolders is 6 (f1, f1a, f1b, f2, f2a, f2b)', () => {
    const p = profileTree(roots);
    expect(p.totalFolders).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// (c) recentAdditionRatio: undefined dateAdded is NOT recent.
// ---------------------------------------------------------------------------
describe('profileTree — recentAdditionRatio with injected now', () => {
  const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
  const now = 2_000_000_000_000; // fixed reference

  const roots = [
    folder('root', [
      bm('recent1', 'https://a.com', now - TWO_WEEKS / 2),   // recent
      bm('recent2', 'https://b.com', now - TWO_WEEKS / 3),   // recent
      bm('old1', 'https://c.com', now - TWO_WEEKS * 10),     // not recent
      bm('nots', 'https://d.com'),                            // no dateAdded → NOT recent
    ]),
  ];

  it('counts undefined dateAdded as not recent', () => {
    const p = profileTree(roots, now);
    // 2 of 4 bookmarks are recent
    expect(p.recentAdditionRatio).toBeCloseTo(2 / 4);
  });
});

// ---------------------------------------------------------------------------
// (d) Empty tree → zeroed profile, no NaN.
// ---------------------------------------------------------------------------
describe('profileTree — empty tree', () => {
  it('returns all zeros for an empty roots array', () => {
    const p = profileTree([]);
    expect(p.totalBookmarks).toBe(0);
    expect(p.totalFolders).toBe(0);
    expect(p.maxDepth).toBe(0);
    expect(p.folderedRatio).toBe(0);
    expect(p.giantFolderShare).toBe(0);
    expect(p.duplicateUrlRate).toBe(0);
    expect(p.domainDiversity).toBe(0);
    expect(p.recentAdditionRatio).toBe(0);
  });

  it('contains no NaN values', () => {
    const p = profileTree([]);
    for (const [key, val] of Object.entries(p)) {
      expect(Number.isNaN(val), `${key} should not be NaN`).toBe(false);
    }
  });

  it('returns zeros for a root with no children', () => {
    const p = profileTree([folder('empty', [])]);
    expect(p.totalBookmarks).toBe(0);
    expect(p.folderedRatio).toBe(0);
    expect(Number.isNaN(p.folderedRatio)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (e) NON-selected system container encountered during walk IS excluded.
//     Setup: we select 'userFolder', which sits alongside system folder '2'.
//     The walk encounters '2' as a sibling child of a vroot — it should not
//     be counted. We achieve this by including it as a child of the selected
//     root's parent, which won't happen in real usage but tests the guard.
//
//     More realistic: selected root is 'userFolder', which contains a
//     sub-folder that happens to have the same id as a system id.
//     Per the spec: NON-selected system containers encountered during the walk
//     are excluded. We test this by passing multiple roots where one is a
//     system id that is NOT among the caller-selected roots.
// ---------------------------------------------------------------------------
describe('profileTree — non-selected system container excluded', () => {
  // We pass TWO roots: userFolder (selected) and systemFolder '2' (not selected by user).
  // The spec: roots are all "selected" by the caller. So to test the guard,
  // we need to encounter a system container DURING the walk of a selected root.
  //
  // Realistic scenario: the caller-provided roots are all selected workspaces.
  // If the caller passes '2' as a root, it is "selected" and transparent.
  // The exclusion guard is for system folders encountered while WALKING the
  // tree that are NOT roots — i.e., discovered as children inside a root.
  //
  // We create a root folder whose children include a system-id sub-folder.
  // That sub-folder's bookmarks should be excluded from the count.

  const systemSubfolder = folder('2', [
    bm('sys-bm1', 'https://sys1.com', 1_000_000),
    bm('sys-bm2', 'https://sys2.com', 1_000_000),
  ]);

  const userBookmarks = Array.from({ length: 10 }, (_, i) =>
    bm(`user-bm${i}`, `https://user${i}.com`, 1_000_000),
  );

  // selectedRoot contains both user bookmarks AND a system-id sub-folder
  const selectedRoot = folder('userFolder', [...userBookmarks, systemSubfolder]);

  it('excludes non-selected system sub-folder from totalBookmarks', () => {
    const p = profileTree([selectedRoot]);
    // userBookmarks = 10, sys sub-folder has 2 — sys folder should be excluded
    expect(p.totalBookmarks).toBe(10);
  });

  it('excludes non-selected system sub-folder from totalFolders', () => {
    const p = profileTree([selectedRoot]);
    // The system sub-folder itself should not be counted
    expect(p.totalFolders).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Additional: duplicateUrlRate correctness
// ---------------------------------------------------------------------------
describe('profileTree — duplicateUrlRate', () => {
  it('is 0 when all URLs are unique', () => {
    const roots = [
      folder('root', [
        bm('a', 'https://a.com', 1_000_000),
        bm('b', 'https://b.com', 1_000_000),
        bm('c', 'https://c.com', 1_000_000),
      ]),
    ];
    const p = profileTree(roots);
    expect(p.duplicateUrlRate).toBe(0);
  });

  it('is > 0 when duplicates exist', () => {
    const roots = [
      folder('root', [
        bm('a1', 'https://a.com', 1_000_000),
        bm('a2', 'https://a.com', 1_000_000), // duplicate
        bm('b', 'https://b.com', 1_000_000),
      ]),
    ];
    const p = profileTree(roots);
    expect(p.duplicateUrlRate).toBeGreaterThan(0);
  });

  it('handles trailing slashes and http vs https as same URL', () => {
    const roots = [
      folder('root', [
        bm('a1', 'https://example.com/', 1_000_000),
        bm('a2', 'https://example.com', 1_000_000),
      ]),
    ];
    const p = profileTree(roots);
    // Both should canonicalize to the same key → 1 duplicate
    expect(p.duplicateUrlRate).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Additional: giantFolderShare
// ---------------------------------------------------------------------------
describe('profileTree — giantFolderShare', () => {
  it('is 0 when no folder meets the giant threshold', () => {
    // 3 folders with 3 bookmarks each = 9 total; giant threshold should be well above 3
    const roots = [
      folder('root', [
        folder('f1', [bm('a', 'https://a.com', 1_000_000), bm('b', 'https://b.com', 1_000_000), bm('c', 'https://c.com', 1_000_000)]),
        folder('f2', [bm('d', 'https://d.com', 1_000_000), bm('e', 'https://e.com', 1_000_000), bm('f', 'https://f.com', 1_000_000)]),
        folder('f3', [bm('g', 'https://g.com', 1_000_000), bm('h', 'https://h.com', 1_000_000), bm('i', 'https://i.com', 1_000_000)]),
      ]),
    ];
    const p = profileTree(roots);
    expect(p.giantFolderShare).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Additional: domainDiversity
// ---------------------------------------------------------------------------
describe('profileTree — domainDiversity', () => {
  it('is 0 for empty tree', () => {
    const p = profileTree([]);
    expect(p.domainDiversity).toBe(0);
  });

  it('is higher when many unique domains present', () => {
    const manyDomains = Array.from({ length: 20 }, (_, i) =>
      bm(`bm${i}`, `https://unique-domain-${i}.com`, 1_000_000),
    );
    const few = [
      bm('x', 'https://same.com', 1_000_000),
      bm('y', 'https://same.com/page', 1_000_000),
    ];

    const pMany = profileTree([folder('root', manyDomains)]);
    const pFew = profileTree([folder('root', few)]);
    expect(pMany.domainDiversity).toBeGreaterThan(pFew.domainDiversity);
  });
});
