import { describe, expect, it } from 'vitest';
import type { BookmarkNode } from '@/shared/messages';
import { scanFolders, SYSTEM_FOLDER_IDS } from '@/newtab/lib/folder-scoring';

// ---------------------------------------------------------------------------
// Helpers — build a browser-shaped tree (outer virtual root -> top-level
// folders -> nested folders/bookmarks) matching what topLevelFolders() expects.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();

/** A bookmark leaf. Distinct domains by default so diversity scoring is easy to control. */
function bookmark(id: string, opts: { domain?: string; dateAdded?: number } = {}): BookmarkNode {
  const domain = opts.domain ?? `${id}site.com`;
  return {
    id,
    title: id,
    url: `https://${domain}/page`,
    dateAdded: opts.dateAdded ?? NOW - 200 * DAY_MS, // old by default (outside 90-day recent window)
  };
}

/** A folder node. */
function folder(id: string, children: BookmarkNode[] = [], parentId?: string): BookmarkNode {
  return { id, title: id, parentId, children };
}

/** Generates N bookmark leaves under a shared id-prefix, each on a distinct domain unless domain is fixed. */
function bookmarks(
  prefix: string,
  count: number,
  opts: { domain?: string; dateAdded?: number } = {},
): BookmarkNode[] {
  return Array.from({ length: count }, (_, i) => bookmark(`${prefix}${i}`, opts));
}

/** Wraps top-level folders in the outer virtual root the real bookmarks tree comes with. */
function wrapTree(topLevel: BookmarkNode[]): BookmarkNode[] {
  return [{ id: 'vroot', title: 'root', children: topLevel }];
}

describe('scanFolders — folders below MIN_BOOKMARKS_TO_SCORE are excluded', () => {
  it('excludes a folder with fewer than 5 bookmarks entirely (score 0, not even suggested)', () => {
    // Business meaning: tiny folders are noise, not organize-worthy candidates.
    const tiny = folder('tiny', bookmarks('t', 4));
    const result = scanFolders(wrapTree([tiny]));
    expect(result.all).toHaveLength(0);
    expect(result.preSelected).toHaveLength(0);
    expect(result.suggested).toHaveLength(0);
  });

  it('includes a folder with exactly 5 bookmarks in `all` (boundary)', () => {
    const atMin = folder('atmin', bookmarks('m', 5));
    const result = scanFolders(wrapTree([atMin]));
    expect(result.all.map(f => f.id)).toContain('atmin');
  });
});

describe('scanFolders — system folders are never candidates', () => {
  it('excludes browser-managed root ids (Chrome bookmarks bar/other/mobile) even with many bookmarks', () => {
    // Business meaning: "Bookmarks Bar" itself should never be recommended as a workspace root.
    for (const sysId of ['1', '2', '3']) {
      const sysFolder = folder(sysId, bookmarks('s', 20));
      const result = scanFolders(wrapTree([sysFolder]));
      expect(result.all.map(f => f.id)).not.toContain(sysId);
    }
  });

  it('excludes Firefox-style system ids', () => {
    const sysFolder = folder('toolbar_____', bookmarks('s', 20));
    const result = scanFolders(wrapTree([sysFolder]));
    expect(result.all).toHaveLength(0);
  });

  it('SYSTEM_FOLDER_IDS contains both Chrome and Firefox container ids', () => {
    expect(SYSTEM_FOLDER_IDS.has('1')).toBe(true);
    expect(SYSTEM_FOLDER_IDS.has('unfiled_____')).toBe(true);
  });
});

describe('scanFolders — candidate collection depth (top-level + one level of subfolders)', () => {
  it('scores a top-level folder (depth 0)', () => {
    const top = folder('top', bookmarks('a', 10));
    const result = scanFolders(wrapTree([top]));
    const scored = result.all.find(f => f.id === 'top');
    expect(scored?.depth).toBe(0);
  });

  it('scores a direct child folder of a top-level folder (depth 1)', () => {
    const child = folder('child', bookmarks('c', 10), 'top');
    const top = folder('top', [child]);
    const result = scanFolders(wrapTree([top]));
    const scored = result.all.find(f => f.id === 'child');
    expect(scored?.depth).toBe(1);
  });

  it('does NOT score a grandchild folder (depth 2) — candidate collection stops at depth 1', () => {
    // Business meaning: only shallow folders are realistic workspace-root candidates;
    // going deeper would recommend folders nested too far to matter as a "workspace".
    const grandchild = folder('grandchild', bookmarks('g', 10), 'child');
    const child = folder('child', [grandchild], 'top');
    const top = folder('top', [child]);
    const result = scanFolders(wrapTree([top]));
    expect(result.all.map(f => f.id)).not.toContain('grandchild');
  });
});

describe('scanFolders — size sub-score scales with total bookmark count', () => {
  // Business meaning: more bookmarks = stronger organize-me signal, in discrete tiers.
  // Isolate the size axis by keeping recency/diversity/structure at their zero floor
  // (all bookmarks old + same domain + no subfolders).
  const oldSameDomain = (count: number): BookmarkNode[] =>
    bookmarks('x', count, { domain: 'same.com', dateAdded: NOW - 200 * DAY_MS });

  it('a 3-bookmark folder scores lowest non-zero size tier (>=3 tier)', () => {
    const f = folder('f3', oldSameDomain(3));
    const result = scanFolders(wrapTree([f]));
    // 3 bookmarks < MIN_BOOKMARKS_TO_SCORE(5) so it won't even be scored — use 5 to be scoreable.
    // (kept as documentation that <5 never reaches scoring; real assertion below uses 6)
    expect(result.all).toHaveLength(0);
  });

  it('size score strictly increases as bookmark count crosses each tier boundary', () => {
    const scoreFor = (count: number): number =>
      scanFolders(wrapTree([folder(`f${count}`, oldSameDomain(count))])).all[0]?.breakdown.size ?? -1;

    const at6 = scoreFor(6);
    const at10 = scoreFor(10);
    const at20 = scoreFor(20);
    const at50 = scoreFor(50);

    // Each tier must score strictly higher — if someone "simplifies" the tier table to a
    // flat/linear function, this ordering assertion catches the behavior change.
    expect(at6).toBeGreaterThan(0);
    expect(at10).toBeGreaterThan(at6);
    expect(at20).toBeGreaterThan(at10);
    expect(at50).toBeGreaterThan(at20);
  });
});

describe('scanFolders — structure sub-score rewards substantial subfolders + depth', () => {
  it('a folder with no subfolders gets zero structure score', () => {
    const flat = folder('flat', bookmarks('a', 10, { domain: 'same.com' }));
    const result = scanFolders(wrapTree([flat]));
    expect(result.all[0].breakdown.structure).toBe(0);
  });

  it('a folder with substantial subfolders (>=2 bookmarks each) scores higher structure than a flat folder', () => {
    // Business meaning: nested organization (subfolders with real content) signals
    // an intentionally-curated area worth promoting to a workspace.
    const sub1 = folder('sub1', bookmarks('s1', 3), 'structured');
    const sub2 = folder('sub2', bookmarks('s2', 3), 'structured');
    const structured = folder('structured', [sub1, sub2, ...bookmarks('d', 4, { domain: 'same.com' })]);
    const flat = folder('flat', bookmarks('a', 10, { domain: 'same.com' }));

    const result = scanFolders(wrapTree([structured, flat]));
    const structuredScore = result.all.find(f => f.id === 'structured')!.breakdown.structure;
    const flatScore = result.all.find(f => f.id === 'flat')!.breakdown.structure;
    expect(structuredScore).toBeGreaterThan(flatScore);
  });

  it('a subfolder with only 1 bookmark does not count as "substantial" (no structure credit)', () => {
    const thinSub = folder('thinsub', bookmarks('t', 1), 'parent');
    const parent = folder('parent', [thinSub, ...bookmarks('d', 6, { domain: 'same.com' })]);
    const result = scanFolders(wrapTree([parent]));
    // Only substantialSubfolders (>=2 bookmarks) earn points; a 1-bookmark subfolder contributes 0.
    expect(result.all.find(f => f.id === 'parent')!.stats.substantialSubfolders).toBe(0);
  });
});

describe('scanFolders — recency sub-score scales with the ratio of recently-added bookmarks', () => {
  // Business meaning: folders with a lot of *recent* activity are more likely to be
  // the user's current focus area, so they should score higher for preselection.
  it('a folder where all bookmarks are old (>90 days) scores 0 recency', () => {
    const allOld = folder('allold', bookmarks('o', 10, { domain: 'same.com', dateAdded: NOW - 200 * DAY_MS }));
    const result = scanFolders(wrapTree([allOld]));
    expect(result.all[0].breakdown.recency).toBe(0);
  });

  it('a folder where all bookmarks were added within the last 90 days scores the max recency tier', () => {
    const allRecent = folder('allrecent', bookmarks('r', 10, { domain: 'same.com', dateAdded: NOW - 10 * DAY_MS }));
    const result = scanFolders(wrapTree([allRecent]));
    expect(result.all[0].breakdown.recency).toBe(25);
  });

  it('recency score increases as the recent-bookmark ratio increases', () => {
    // 10 total: vary how many are recent.
    const buildMixed = (recentCount: number): BookmarkNode[] => [
      ...bookmarks('rec', recentCount, { domain: 'same.com', dateAdded: NOW - 10 * DAY_MS }),
      ...bookmarks('old', 10 - recentCount, { domain: 'same.com', dateAdded: NOW - 200 * DAY_MS }),
    ];
    const scoreFor = (recentCount: number): number =>
      scanFolders(wrapTree([folder(`mix${recentCount}`, buildMixed(recentCount))])).all[0].breakdown.recency;

    const low = scoreFor(1); // ratio 0.1 -> >0 tier
    const mid = scoreFor(4); // ratio 0.4 -> >0.3 tier
    const high = scoreFor(6); // ratio 0.6 -> >0.5 tier
    expect(low).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });
});

describe('scanFolders — diversity sub-score scales with unique domain count', () => {
  // Business meaning: a folder spanning many distinct sites suggests a broad-purpose
  // collection (e.g. "Research"), which is a strong workspace candidate.
  it('a folder where every bookmark shares the same domain scores 0 diversity', () => {
    const sameSite = folder('samesite', bookmarks('s', 10, { domain: 'same.com' }));
    const result = scanFolders(wrapTree([sameSite]));
    expect(result.all[0].breakdown.diversity).toBe(0);
  });

  it('a folder with 10+ unique domains scores the max diversity tier', () => {
    const manyDomains = folder('manydomains', bookmarks('d', 10)); // default: distinct domain per bookmark
    const result = scanFolders(wrapTree([manyDomains]));
    expect(result.all[0].breakdown.diversity).toBe(25);
  });

  it('diversity score increases as unique domain count crosses tier boundaries', () => {
    const buildDomains = (uniqueCount: number, total: number): BookmarkNode[] =>
      Array.from({ length: total }, (_, i) =>
        bookmark(`d${i}`, { domain: `domain${i % uniqueCount}.com`, dateAdded: NOW - 200 * DAY_MS }));

    const scoreFor = (uniqueCount: number, total: number): number =>
      scanFolders(wrapTree([folder(`u${uniqueCount}`, buildDomains(uniqueCount, total))])).all[0].breakdown.diversity;

    const two = scoreFor(2, 10);
    const three = scoreFor(3, 10);
    const six = scoreFor(6, 10);
    expect(two).toBeGreaterThan(0);
    expect(three).toBeGreaterThan(two);
    expect(six).toBeGreaterThan(three);
  });
});

describe('scanFolders — tiering: preselect', () => {
  // PRESELECT_SCORE_THRESHOLD=55, PRESELECT_MIN_BOOKMARKS=12, MAX_PRESELECTIONS=3
  it('preselects a folder that clears both the score threshold AND the min-bookmark floor', () => {
    // Build a folder that maxes size + structure + recency + diversity to comfortably clear 55.
    const sub1 = folder('psub1', bookmarks('ps1', 3), 'strong');
    const sub2 = folder('psub2', bookmarks('ps2', 3), 'strong');
    const strong = folder('strong', [
      sub1,
      sub2,
      ...bookmarks('main', 14, { dateAdded: NOW - 5 * DAY_MS }), // recent + distinct domains
    ]);
    const result = scanFolders(wrapTree([strong]));
    const scored = result.all.find(f => f.id === 'strong')!;
    expect(scored.stats.totalBookmarks).toBeGreaterThanOrEqual(12);
    expect(scored.score).toBeGreaterThanOrEqual(55);
    expect(scored.tier).toBe('preselect');
    expect(result.preSelected.map(f => f.id)).toContain('strong');
  });

  it('does NOT preselect a folder that clears the score threshold but has fewer than 12 bookmarks', () => {
    // Business meaning: a small folder shouldn't jump straight to "preselected" even if
    // its per-bookmark quality signals (recency/diversity) are strong — preselection implies
    // there's enough content to justify carving out a whole workspace.
    const smallButHighQuality = folder('smallhq', bookmarks('shq', 10, { dateAdded: NOW - 5 * DAY_MS }));
    const result = scanFolders(wrapTree([smallButHighQuality]));
    const scored = result.all.find(f => f.id === 'smallhq')!;
    expect(scored.stats.totalBookmarks).toBeLessThan(12);
    expect(scored.tier).not.toBe('preselect');
  });

  it('caps preselection at MAX_PRESELECTIONS (3), demoting the rest to suggested', () => {
    // Business meaning: onboarding should never overwhelm the user with more than 3
    // preselected workspace candidates, even if more folders qualify.
    const strongFolders = Array.from({ length: 5 }, (_, i) => {
      const id = `strong${i}`;
      const s1 = folder(`${id}sub1`, bookmarks(`${id}s1`, 3), id);
      const s2 = folder(`${id}sub2`, bookmarks(`${id}s2`, 3), id);
      return folder(id, [s1, s2, ...bookmarks(`${id}main`, 14, { dateAdded: NOW - 5 * DAY_MS })]);
    });
    const result = scanFolders(wrapTree(strongFolders));
    expect(result.preSelected.length).toBeLessThanOrEqual(3);
    // The qualifying folders beyond the cap must still show up, just demoted to suggested.
    const qualifying = result.all.filter(f => f.score >= 55 && f.stats.totalBookmarks >= 12);
    expect(qualifying.length).toBe(5);
    expect(result.suggested.length).toBeGreaterThanOrEqual(2);
  });
});

describe('scanFolders — tiering: suggest', () => {
  it('suggests a folder scoring between SUGGEST_SCORE_THRESHOLD(35) and the preselect bar', () => {
    // 10 bookmarks (size=20) across 6 domains (diversity=20), all old + no subfolders
    // (recency=0, structure=0) -> score 40: inside the suggest band (35-54) and below
    // PRESELECT_MIN_BOOKMARKS(12), so this pins the suggest tier without touching preselect.
    const moderate = folder('moderate', Array.from({ length: 10 }, (_, i) =>
      bookmark(`mod${i}`, { domain: `moddomain${i % 6}.com`, dateAdded: NOW - 200 * DAY_MS })));
    const result = scanFolders(wrapTree([moderate]));
    const scored = result.all.find(f => f.id === 'moderate')!;

    expect(scored.score).toBeGreaterThanOrEqual(35);
    expect(scored.score).toBeLessThan(55);
    expect(scored.tier).toBe('suggest');
    expect(result.suggested.map(f => f.id)).toContain('moderate');
    expect(result.preSelected.map(f => f.id)).not.toContain('moderate');
  });

  it('does not tier a folder scoring below SUGGEST_SCORE_THRESHOLD (35) — tier stays "none"', () => {
    // 5 bookmarks (the scoring floor), all old, same domain, no structure -> minimal score.
    const weak = folder('weak', bookmarks('w', 5, { domain: 'same.com', dateAdded: NOW - 200 * DAY_MS }));
    const result = scanFolders(wrapTree([weak]));
    const scored = result.all.find(f => f.id === 'weak')!;
    expect(scored.score).toBeLessThan(35);
    expect(scored.tier).toBe('none');
    expect(result.preSelected.map(f => f.id)).not.toContain('weak');
    expect(result.suggested.map(f => f.id)).not.toContain('weak');
  });
});

describe('scanFolders — parent/child dedup', () => {
  // Business meaning: if both a folder and its own direct subfolder qualify for
  // preselection, showing both as separate "workspace" candidates is redundant —
  // the child's bookmarks are already inside the parent. The parent should win the
  // preselect slot and the child gets demoted to "suggest" instead of disappearing.
  it('demotes a preselected folder to suggest when its direct parent is ALSO preselected', () => {
    const strongChild = folder('strongchild', [
      ...bookmarks('cmain', 14, { dateAdded: NOW - 5 * DAY_MS }),
    ], 'strongparent');
    // Give the child its own substantial subfolders so it independently clears the preselect bar.
    const childSub1 = folder('cs1', bookmarks('cs1b', 3), 'strongchild');
    const childSub2 = folder('cs2', bookmarks('cs2b', 3), 'strongchild');
    strongChild.children = [...(strongChild.children ?? []), childSub1, childSub2];

    const parentSub1 = folder('ps1', bookmarks('ps1b', 3), 'strongparent');
    const parentSub2 = folder('ps2', bookmarks('ps2b', 3), 'strongparent');
    const strongParent = folder('strongparent', [
      strongChild,
      parentSub1,
      parentSub2,
      ...bookmarks('pmain', 14, { dateAdded: NOW - 5 * DAY_MS }),
    ]);

    const result = scanFolders(wrapTree([strongParent]));

    const parentScored = result.all.find(f => f.id === 'strongparent')!;
    const childScored = result.all.find(f => f.id === 'strongchild')!;

    // Sanity: both independently qualify for preselect on score/size before dedup.
    expect(parentScored.score).toBeGreaterThanOrEqual(55);
    expect(childScored.score).toBeGreaterThanOrEqual(55);

    // After dedup: at most one of {parent, child} remains preselected — they can't both
    // occupy a preselect slot since the child's content is a subset of the parent's.
    const preSelectedIds = result.preSelected.map(f => f.id);
    expect(preSelectedIds).toContain('strongparent');
    expect(preSelectedIds).not.toContain('strongchild');

    // The demoted child must reappear as a suggestion, not vanish entirely.
    expect(result.suggested.map(f => f.id)).toContain('strongchild');
    expect(childScored.tier).toBe('suggest');
  });

  it('does NOT demote two preselected folders that are siblings (no parent/child relationship)', () => {
    const buildStrong = (id: string): BookmarkNode => {
      const s1 = folder(`${id}s1`, bookmarks(`${id}s1b`, 3), id);
      const s2 = folder(`${id}s2`, bookmarks(`${id}s2b`, 3), id);
      return folder(id, [s1, s2, ...bookmarks(`${id}main`, 14, { dateAdded: NOW - 5 * DAY_MS })]);
    };
    const siblingA = buildStrong('siba');
    const siblingB = buildStrong('sibb');
    const result = scanFolders(wrapTree([siblingA, siblingB]));

    const preSelectedIds = result.preSelected.map(f => f.id);
    expect(preSelectedIds).toContain('siba');
    expect(preSelectedIds).toContain('sibb');
  });
});

describe('scanFolders — `all` is sorted by score descending', () => {
  it('orders scored folders from highest to lowest score', () => {
    const weak = folder('weak', bookmarks('w', 5, { domain: 'same.com', dateAdded: NOW - 200 * DAY_MS }));
    const strong = folder('strong', bookmarks('s', 20, { dateAdded: NOW - 5 * DAY_MS }));
    const result = scanFolders(wrapTree([weak, strong]));
    const scores = result.all.map(f => f.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(result.all[0].id).toBe('strong');
  });
});
