import { writeBookmarkUsageRecord } from '../../shared/storage';
import type { AppState } from '../state/app-state';

export function getBookmarkLastUsed(state: AppState, bookmarkId: string): number {
  return state.bookmarkUsage[bookmarkId]?.usedAt ?? 0;
}

export function markBookmarkUsed(state: AppState, bookmarkId: string): void {
  const usedAt = Date.now();
  state.bookmarkUsage = {
    ...state.bookmarkUsage,
    [bookmarkId]: {
      bookmarkId,
      usedAt,
    },
  };

  void writeBookmarkUsageRecord({
    bookmarkId,
    usedAt,
  });
}