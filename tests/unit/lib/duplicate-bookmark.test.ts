import { describe, expect, it } from 'vitest';
import type { BookmarkNode } from '@/shared/messages';
import { findDuplicateBookmark } from '@/newtab/lib/duplicate-bookmark';

// Matches the browser-shaped tree other lib tests build: an outer virtual
// root wrapping top-level folders (see folder-scoring.test.ts).
function wrapTree(topLevel: BookmarkNode[]): BookmarkNode[] {
  return [{ id: 'vroot', title: 'root', children: topLevel }];
}

describe('findDuplicateBookmark', () => {
  it('finds a bookmark whose canonical URL matches exactly, returning its containing folder title', () => {
    const tree = wrapTree([
      {
        id: 'work',
        title: 'Work',
        children: [
          { id: 'b1', title: 'Example', url: 'https://example.com/page' },
        ],
      },
    ]);

    const result = findDuplicateBookmark(tree, 'https://example.com/page');
    expect(result).toEqual({ folderTitle: 'Work' });
  });

  it('matches despite a trailing slash difference (canonicalUrlForDedup strips it)', () => {
    const tree = wrapTree([
      {
        id: 'work',
        title: 'Work',
        children: [
          { id: 'b1', title: 'Example', url: 'https://example.com/page/' },
        ],
      },
    ]);

    const result = findDuplicateBookmark(tree, 'https://example.com/page');
    expect(result).toEqual({ folderTitle: 'Work' });
  });

  it('matches despite http vs https protocol difference (canonicalUrlForDedup normalizes to https)', () => {
    const tree = wrapTree([
      {
        id: 'personal',
        title: 'Personal',
        children: [
          { id: 'b1', title: 'Example', url: 'http://example.com/page' },
        ],
      },
    ]);

    const result = findDuplicateBookmark(tree, 'https://example.com/page');
    expect(result).toEqual({ folderTitle: 'Personal' });
  });

  it('treats different query params as distinct URLs and returns null', () => {
    const tree = wrapTree([
      {
        id: 'work',
        title: 'Work',
        children: [
          { id: 'b1', title: 'Example', url: 'https://example.com/page?tab=1' },
        ],
      },
    ]);

    const result = findDuplicateBookmark(tree, 'https://example.com/page?tab=2');
    expect(result).toBeNull();
  });

  it('matches when query params are identical', () => {
    const tree = wrapTree([
      {
        id: 'work',
        title: 'Work',
        children: [
          { id: 'b1', title: 'Example', url: 'https://example.com/page?tab=1' },
        ],
      },
    ]);

    const result = findDuplicateBookmark(tree, 'https://example.com/page?tab=1');
    expect(result).toEqual({ folderTitle: 'Work' });
  });

  it('returns null when no bookmark matches', () => {
    const tree = wrapTree([
      {
        id: 'work',
        title: 'Work',
        children: [
          { id: 'b1', title: 'Example', url: 'https://example.com/page' },
        ],
      },
    ]);

    const result = findDuplicateBookmark(tree, 'https://other.com/');
    expect(result).toBeNull();
  });

  it('returns null for an unparseable or non-http(s) URL', () => {
    const tree = wrapTree([
      {
        id: 'work',
        title: 'Work',
        children: [
          { id: 'b1', title: 'Example', url: 'https://example.com/page' },
        ],
      },
    ]);

    expect(findDuplicateBookmark(tree, 'not a url')).toBeNull();
    expect(findDuplicateBookmark(tree, 'chrome://settings')).toBeNull();
  });

  it('returns the nested folder title, not an ancestor, for a deeply nested match', () => {
    const tree = wrapTree([
      {
        id: 'work',
        title: 'Work',
        children: [
          {
            id: 'nested',
            title: 'Nested',
            children: [
              { id: 'b1', title: 'Example', url: 'https://example.com/page' },
            ],
          },
        ],
      },
    ]);

    const result = findDuplicateBookmark(tree, 'https://example.com/page');
    expect(result).toEqual({ folderTitle: 'Nested' });
  });
});
