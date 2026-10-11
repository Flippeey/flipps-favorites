import { describe, expect, it } from 'vitest';
import type { BookmarkNode, FolderLocator } from '@/shared/models';
import {
  buildFolderLocator,
  locatorHash,
  normalizeUrlForMatch,
  resolveFolder,
  uniqueBookmarkForUrl,
} from '@/shared/folder-locator';

// Fixture trees follow what each browser's bookmark importer produces:
// Firefox's ChromeProfileMigrator (current and ESR102), Firefox ESR91's
// "From Google Chrome" wrapper, and Chrome's Firefox importer with its
// "Imported From Firefox" folder on the bar.

const links = (prefix: string, count: number): BookmarkNode[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, title: `${prefix} ${i}`, url: `https://${prefix}.example/${i}` }));
const dir = (id: string, title: string, children: BookmarkNode[] = [], extra: Partial<BookmarkNode> = {}): BookmarkNode =>
  ({ id, title, children, ...extra });
const tree = (...roots: BookmarkNode[]): BookmarkNode[] => [{ id: 'root', title: '', children: roots }];

const chromeBar = (id: string, children: BookmarkNode[], extra: Partial<BookmarkNode> = {}): BookmarkNode =>
  dir(id, 'Bookmarks bar', children, { folderType: 'bookmarks-bar', ...extra });
const chromeOther = (children: BookmarkNode[]): BookmarkNode => dir('2', 'Other bookmarks', children, { folderType: 'other' });
const chromeMobile = (children: BookmarkNode[]): BookmarkNode => dir('3', 'Mobile bookmarks', children, { folderType: 'mobile' });
const ffToolbar = (children: BookmarkNode[]): BookmarkNode => dir('toolbar_____', 'Bookmarks Toolbar', children);
const ffMenu = (children: BookmarkNode[]): BookmarkNode => dir('menu________', 'Bookmarks Menu', children);
const ffOther = (children: BookmarkNode[]): BookmarkNode => dir('unfiled_____', 'Other Bookmarks', children);
const ffMobile = (children: BookmarkNode[]): BookmarkNode => dir('mobile______', 'Mobile Bookmarks', children);

// The same folder content under each browser's own ids.
const work = (id: string): BookmarkNode => dir(id, 'Work', links('work', 6));
const clients = (id: string): BookmarkNode => dir(id, 'Clients', links('clients', 4));
const recipes = (id: string): BookmarkNode => dir(id, 'Recipes', links('recipes', 6));
const phone = (id: string): BookmarkNode => dir(id, 'Phone', links('phone', 4));
const firefoxDefaults = dir('ff-default', 'Mozilla Firefox', links('mozilla', 3));

const chromeTree = tree(
  chromeBar('1', [dir('c-work', 'Work', [...links('work', 6), clients('c-clients')])]),
  chromeOther([recipes('c-recipes')]),
  chromeMobile([phone('c-phone')]),
);
const locate = (source: BookmarkNode[], id: string): FolderLocator => {
  const locator = buildFolderLocator(source, id);
  if (!locator) throw new Error(`no folder ${id}`);
  return locator;
};

describe('buildFolderLocator', () => {
  it('describes a folder by root kind, titles below the root and hashed direct children', () => {
    const locator = locate(chromeTree, 'c-clients');
    expect(locator.rootKind).toBe('toolbar');
    expect(locator.path).toEqual(['Work', 'Clients']);
    expect(locator.fingerprint).toHaveLength(4);
  });

  it('hashes with 32-bit FNV-1a, so every browser computes the same fingerprint', () => {
    const source = tree(chromeBar('1', [dir('f', 'F', [dir('a', 'a'), { id: 'b', title: 'b', url: 'HTTPS://Example.com/#top' }])]));
    // FNV-1a of "d:a" and of the normalized URL "https://example.com".
    expect(locate(source, 'f').fingerprint).toEqual(['6fbc04d3', 'd4d7133e']);
  });

  it('keeps only the 16 smallest hashes of a large folder', () => {
    const big = links('big', 40);
    const singles = tree(chromeBar('1', big.map(link => dir(`only-${link.id}`, 'x', [link]))));
    const everyHash = big.map(link => locate(singles, `only-${link.id}`).fingerprint[0]);
    const smallest = [...everyHash].sort((a, b) => parseInt(a, 16) - parseInt(b, 16)).slice(0, 16);
    expect(locate(tree(chromeBar('1', [dir('big', 'Big', big)])), 'big').fingerprint).toEqual(smallest);
  });

  it('uses the root id when an older Chrome gives no folderType', () => {
    const old = tree(dir('1', 'Bookmarks bar', [work('w')]), dir('2', 'Other bookmarks', []));
    expect(locate(old, 'w').rootKind).toBe('toolbar');
    expect(locate(tree(ffMenu([work('m')])), 'm').rootKind).toBe('menu');
  });

  it('gives the same hash to the same locator and a different one when it changes', () => {
    const a = locate(chromeTree, 'c-work');
    expect(locatorHash(a)).toBe(locatorHash({ ...a }));
    expect(locatorHash({ ...a, path: ['Renamed'] })).not.toBe(locatorHash(a));
    expect(locatorHash(undefined)).toBe('');
  });
});

describe('resolveFolder — Firefox importing from Chrome', () => {
  it('modern layout: bar to toolbar, other and mobile to Other Bookmarks', () => {
    const firefox = tree(
      ffToolbar([firefoxDefaults, dir('f-work', 'Work', [...links('work', 6), clients('f-clients')])]),
      ffMenu([]),
      ffOther([recipes('f-recipes'), phone('f-phone')]),
      ffMobile([]),
    );
    expect(resolveFolder(locate(chromeTree, 'c-work'), firefox, { hintId: 'c-work' })).toBe('f-work');
    expect(resolveFolder(locate(chromeTree, 'c-clients'), firefox)).toBe('f-clients');
    expect(resolveFolder(locate(chromeTree, 'c-recipes'), firefox)).toBe('f-recipes');
    expect(resolveFolder(locate(chromeTree, 'c-phone'), firefox)).toBe('f-phone');
  });

  it('ESR102 layout: Chrome other bookmarks land in the Bookmarks Menu', () => {
    const firefox = tree(ffToolbar([]), ffMenu([recipes('m-recipes')]), ffOther([]));
    expect(resolveFolder(locate(chromeTree, 'c-recipes'), firefox)).toBe('m-recipes');
  });

  it('legacy "From Google Chrome" wrapper adds one level under the toolbar', () => {
    const firefox = tree(ffToolbar([dir('wrap', 'From Google Chrome', [dir('f-work', 'Work', [...links('work', 6), clients('f-clients')])])]));
    expect(resolveFolder(locate(chromeTree, 'c-clients'), firefox)).toBe('f-clients');
    expect(resolveFolder(locate(chromeTree, 'c-work'), firefox)).toBe('f-work');
  });
});

describe('resolveFolder — Chrome importing from Firefox', () => {
  const firefoxTree = tree(
    ffToolbar([dir('f-work', 'Work', [...links('work', 6), clients('f-clients')])]),
    ffMenu([]),
    ffOther([recipes('f-recipes')]),
  );

  it('empty bar: toolbar items land on the bar, the rest under "Imported From Firefox"', () => {
    const chrome = tree(
      chromeBar('1', [
        dir('c-work', 'Work', [...links('work', 6), clients('c-clients')]),
        dir('imp', 'Imported From Firefox', [dir('imp-other', 'Other Bookmarks', [recipes('c-recipes')])]),
      ]),
      chromeOther([]),
    );
    expect(resolveFolder(locate(firefoxTree, 'f-work'), chrome)).toBe('c-work');
    expect(resolveFolder(locate(firefoxTree, 'f-clients'), chrome)).toBe('c-clients');
    expect(resolveFolder(locate(firefoxTree, 'f-recipes'), chrome)).toBe('c-recipes');
  });

  it('non-empty bar: everything goes two levels down under the import folder', () => {
    const chrome = tree(chromeBar('1', [
      dir('mine', 'Mine', links('mine', 2)),
      dir('imp', 'Imported From Firefox', [
        dir('imp-tb', 'Bookmarks Toolbar', [dir('c-work', 'Work', [...links('work', 6), clients('c-clients')])]),
        dir('imp-other', 'Other Bookmarks', [recipes('c-recipes')]),
      ]),
    ]));
    expect(resolveFolder(locate(firefoxTree, 'f-work'), chrome)).toBe('c-work');
    expect(resolveFolder(locate(firefoxTree, 'f-clients'), chrome)).toBe('c-clients');
    expect(resolveFolder(locate(firefoxTree, 'f-recipes'), chrome)).toBe('c-recipes');
  });

  it('no toolbar items: everything lands top-level on the bar, under a different root kind', () => {
    const chrome = tree(chromeBar('1', [recipes('c-recipes')]), chromeOther([]));
    expect(resolveFolder(locate(firefoxTree, 'f-recipes'), chrome)).toBe('c-recipes');
  });

  it('a wrapper named in another language is never compared', () => {
    const chrome = tree(chromeBar('1', [
      dir('mine', 'Mine', []),
      dir('imp', 'Importé depuis Firefox', [dir('imp-tb', 'Barre personnelle', [dir('c-work', 'Work', [...links('work', 6), clients('c-clients')])])]),
    ]));
    expect(resolveFolder(locate(firefoxTree, 'f-clients'), chrome)).toBe('c-clients');
  });

  it('a locator made in Chrome after an import is the longer path, and still resolves in Firefox', () => {
    const chrome = tree(chromeBar('1', [
      dir('imp', 'Imported From Firefox', [dir('imp-tb', 'Bookmarks Toolbar', [dir('c-work', 'Work', [...links('work', 6), clients('c-clients')])])]),
    ]));
    const stored = locate(chrome, 'c-clients');
    expect(stored.path).toEqual(['Imported From Firefox', 'Bookmarks Toolbar', 'Work', 'Clients']);
    expect(resolveFolder(stored, firefoxTree)).toBe('f-clients');
  });

  it('three extra levels are too many', () => {
    const chrome = tree(chromeBar('1', [dir('x', 'X', [dir('y', 'Y', [dir('z', 'Z', [dir('c-work', 'Work', [clients('c-clients')])])])])]));
    const stored: FolderLocator = { ...locate(firefoxTree, 'f-clients'), fingerprint: [] };
    expect(resolveFolder(stored, chrome)).toBeNull();
  });
});

describe('resolveFolder — roots', () => {
  it("Chrome's bar is Firefox's toolbar, whatever each is called", () => {
    const firefox = tree(ffToolbar(links('work', 3)), ffMenu([]), ffOther(links('work', 3)));
    const barLocator = locate(tree(chromeBar('1', links('work', 3))), '1');
    expect(barLocator.path).toEqual([]);
    expect(resolveFolder(barLocator, firefox)).toBe('toolbar_____');
  });

  it('a root locator never matches a folder below a root', () => {
    const firefox = tree(ffMenu([dir('fake-bar', 'Bookmarks bar', links('work', 3))]));
    expect(resolveFolder(locate(tree(chromeBar('1', links('work', 3))), '1'), firefox)).toBeNull();
  });

  it('twin account and local bars: content picks one, identical content waits', () => {
    const source = tree(chromeBar('acct', links('work', 4), { syncing: true }), chromeBar('1', links('home', 4), { syncing: false }));
    const target = tree(chromeBar('b-acct', links('work', 4), { syncing: true }), chromeBar('b-local', links('home', 4), { syncing: false }));
    expect(resolveFolder(locate(source, 'acct'), target)).toBe('b-acct');
    expect(resolveFolder(locate(source, '1'), target)).toBe('b-local');

    const twins = tree(chromeBar('t1', links('same', 4)), chromeBar('t2', links('same', 4)));
    expect(resolveFolder(locate(twins, 't1'), tree(chromeBar('u1', links('same', 4)), chromeBar('u2', links('same', 4))))).toBeNull();
  });
});

describe('resolveFolder — ambiguity, veto and hints', () => {
  it('duplicate titles wait, unless the fingerprint tells them apart', () => {
    const target = tree(chromeBar('1', [dir('a', 'Work', links('alpha', 4)), dir('b', 'Work', links('beta', 4))]));
    const alpha = locate(tree(chromeBar('1', [dir('x', 'Work', links('alpha', 4))])), 'x');
    expect(resolveFolder(alpha, target)).toBe('a');
    expect(resolveFolder({ ...alpha, fingerprint: [] }, target)).toBeNull();
  });

  it('five or more stored hashes sharing none with a candidate rule it out', () => {
    const target = tree(chromeBar('1', [dir('w', 'Work', links('other', 6))]));
    const five = locate(tree(chromeBar('1', [dir('x', 'Work', links('work', 5))])), 'x');
    expect(resolveFolder(five, target)).toBeNull();
    expect(resolveFolder(five, target, { hintId: 'w' })).toBeNull();
    // Four hashes are too few to veto: an exact path still resolves.
    const four = locate(tree(chromeBar('1', [dir('x', 'Work', links('work', 4))])), 'x');
    expect(resolveFolder(four, target)).toBe('w');
  });

  it("Chrome to Chrome: a foreign id naming another folder here is rejected and the right one found", () => {
    const a = tree(chromeBar('1', [dir('57', 'Work', links('work', 6))]));
    const b = tree(chromeBar('1', [dir('57', 'Recipes', links('recipes', 6)), dir('90', 'Work', links('work', 6))]));
    expect(resolveFolder(locate(a, '57'), b, { hintId: '57' })).toBe('90');
  });

  it('a foreign id is taken when content confirms it, even after a rename', () => {
    const a = tree(chromeBar('1', [dir('57', 'Work', links('work', 6))]));
    const b = tree(chromeBar('1', [dir('57', 'Job', links('work', 6))]));
    expect(resolveFolder(locate(a, '57'), b, { hintId: '57' })).toBe('57');
  });

  it("this browser's own binding survives a rename, a move and new content", () => {
    const locator = locate(chromeTree, 'c-work');
    const moved = tree(chromeBar('1', []), chromeOther([dir('deep', 'Deep', [dir('c-work', 'Renamed', links('new', 7))])]));
    const binding = { localId: 'c-work', locatorHash: locatorHash(locator), state: 'bound' as const };
    expect(resolveFolder(locator, moved, { binding })).toBe('c-work');
    // Made for an older locator, the binding is not trusted.
    expect(resolveFolder(locator, moved, { binding: { ...binding, locatorHash: 'stale' } })).toBeNull();
  });

  it('a one-element path needs the fingerprint to agree', () => {
    const stored = locate(tree(ffToolbar([dir('f', 'Work', links('work', 3))])), 'f');
    const agreeing = tree(chromeBar('1', [dir('imp', 'Imported From Firefox', [dir('c', 'Work', links('work', 3))])]));
    const different = tree(chromeBar('1', [dir('imp', 'Imported From Firefox', [dir('c', 'Work', links('other', 3))])]));
    expect(resolveFolder(stored, agreeing)).toBe('c');
    expect(resolveFolder(stored, different)).toBeNull();
  });

  it('content alone finds a moved and renamed folder only with a clear lead', () => {
    const stored = locate(tree(chromeBar('1', [dir('x', 'Work', links('work', 5))])), 'x');
    const target = tree(chromeBar('1', [dir('y', 'Elsewhere', [dir('z', 'Job', [...links('work', 4), ...links('noise', 1)])])]));
    expect(resolveFolder(stored, target)).toBe('z');
    const twoCopies = tree(chromeBar('1', [dir('z1', 'Job', links('work', 5)), dir('z2', 'Old job', links('work', 5))]));
    expect(resolveFolder(stored, twoCopies)).toBeNull();
  });

  it('bookmarks added after linking resolve on the next pass', () => {
    const stored = locate(chromeTree, 'c-recipes');
    expect(resolveFolder(stored, tree(ffToolbar([]), ffOther([])))).toBeNull();
    expect(resolveFolder(stored, tree(ffToolbar([]), ffOther([recipes('late')])))).toBe('late');
  });

  it('a record made before locators existed needs a unique folder titled like the workspace', () => {
    const target = tree(chromeBar('1', [dir('j', 'Jason', []), dir('d1', 'Twin', []), dir('d2', 'Twin', [])]));
    expect(resolveFolder(undefined, target, { title: 'Jason', hintId: 'other-browser-id' })).toBe('j');
    expect(resolveFolder(undefined, target, { title: 'Twin' })).toBeNull();
    // The hint alone never places a locator-less record.
    expect(resolveFolder(undefined, target, { title: 'Nope', hintId: 'j' })).toBeNull();
  });
});

describe('usage URL matching', () => {
  const target = tree(chromeBar('1', [
    { id: 'u1', title: 'One', url: 'HTTPS://One.Example/path/#frag' },
    { id: 'd1', title: 'Dup', url: 'https://dup.example/' },
    dir('f', 'F', [{ id: 'd2', title: 'Dup again', url: 'https://dup.example' }]),
  ]));

  it('binds to the one bookmark with that URL, after normalizing', () => {
    expect(normalizeUrlForMatch('HTTPS://One.Example/path/#frag')).toBe('https://one.example/path');
    expect(uniqueBookmarkForUrl(target, 'https://one.example/path')).toBe('u1');
  });

  it('does not bind when several bookmarks share the URL', () => {
    expect(uniqueBookmarkForUrl(target, 'https://dup.example/')).toBeNull();
  });

  it('does not bind when no bookmark has the URL', () => {
    expect(uniqueBookmarkForUrl(target, 'https://absent.example')).toBeNull();
  });
});
