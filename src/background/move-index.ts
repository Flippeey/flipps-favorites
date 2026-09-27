// Pure index math for a bookmark move — no extensionApi import at module
// evaluation, so this stays importable from Vitest (see architecture.md,
// "Dual-Target Builds": mixing extensionApi imports into a module that also
// needs to load under Vitest breaks the test).

export interface MoveIndexCompensationInput {
  requestedIndex: number | undefined;
  targetParentId: string;
  currentParentId: string | undefined;
  currentIndex: number | undefined;
}

// Chrome/WebExtensions same-parent move quirk: when the target index is
// greater than the bookmark's current index, the browser subtracts 1
// internally (the item shifts left on removal before landing). The UI passes
// a post-removal index, so bump it by 1 in that case so the item lands where
// intended. A move to a different parent, or with no current position known,
// needs no compensation.
export function computeBookmarkMoveIndex(input: MoveIndexCompensationInput): number | undefined {
  const { requestedIndex, targetParentId, currentParentId, currentIndex } = input;
  if (typeof requestedIndex !== 'number') return requestedIndex;
  if (
    currentParentId === targetParentId &&
    typeof currentIndex === 'number' &&
    requestedIndex > currentIndex
  ) {
    return requestedIndex + 1;
  }
  return requestedIndex;
}
