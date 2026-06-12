import { describe, expect, it } from 'vitest';
import type { WorkspaceRecord } from '@/shared/messages';
import { effectiveViewSort } from '@/newtab/lib/effective-view-sort';

function makeWorkspace(overrides: Partial<WorkspaceRecord>): WorkspaceRecord {
  return {
    id: 'w1',
    name: 'Workspace',
    rootFolderId: '1',
    themeMode: 'system',
    accentColor: '#3F72DC',
    backgroundMode: 'gradient',
    solidBackgroundColor: '',
    gradientStyle: 'top',
    gradientColorSource: 'accent',
    gradientCustomColor: '#3F72DC',
    gradientIntensity: 100,
    backgroundOpacity: 70,
    backgroundFitMode: 'cover',
    backgroundPositionMode: 'center',
    layoutPreset: 'balanced',
    favoritesColumnGap: 24,
    favoritesRowGap: 20,
    bookmarkTileWidth: 130,
    bookmarkIconSize: 75,
    tileShape: 'squircle',
    showTileLabels: true,
    folderMode: 'grid',
    bookmarkSortMode: 'manual',
    bookmarkSortDirection: 'asc',
    ...overrides,
  };
}

describe('effectiveViewSort', () => {
  it('falls back to grid/manual/asc when there is no active workspace', () => {
    expect(effectiveViewSort(null)).toEqual({
      folderMode: 'grid',
      bookmarkSortMode: 'manual',
      bookmarkSortDirection: 'asc',
    });
  });

  it('reads view + sort from the active workspace', () => {
    const ws = makeWorkspace({
      folderMode: 'list',
      bookmarkSortMode: 'name',
      bookmarkSortDirection: 'desc',
    });
    expect(effectiveViewSort(ws)).toEqual({
      folderMode: 'list',
      bookmarkSortMode: 'name',
      bookmarkSortDirection: 'desc',
    });
  });

  it('reflects each workspace independently (the WHY: per-workspace identity)', () => {
    const grid = makeWorkspace({ id: 'a', folderMode: 'grid', bookmarkSortMode: 'manual', bookmarkSortDirection: 'asc' });
    const list = makeWorkspace({ id: 'b', folderMode: 'list', bookmarkSortMode: 'created', bookmarkSortDirection: 'desc' });
    expect(effectiveViewSort(grid).folderMode).toBe('grid');
    expect(effectiveViewSort(list).folderMode).toBe('list');
    expect(effectiveViewSort(grid).bookmarkSortMode).toBe('manual');
    expect(effectiveViewSort(list).bookmarkSortMode).toBe('created');
  });
});
