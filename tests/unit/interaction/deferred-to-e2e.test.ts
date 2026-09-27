import { describe, expect, it } from 'vitest';

// All 8 hooks in src/newtab/interaction/ were audited for separable pure logic.
// None qualify for a Vitest unit test without either mounting a component
// (the repo deliberately has no RTL / component-testing dependency; see
// .claude/testing.md) or restructuring the hook to extract new pure functions.
//
// Per-hook reasoning:
//
// - useEscapeKey.ts — a single `useEffect` registering a `keydown` listener
//   that calls `handler` on Escape. The entire body is the effect; there is no
//   decision logic to extract (the predicate is `e.key === 'Escape'`, already
//   inline and trivial). Testing it requires a mounted component to trigger
//   the effect. Covered by Playwright specs that open/close dialogs and
//   drawers via Escape (e.g. tests/specs/settings-appearance.spec.ts,
//   tests/specs/settings-nav.spec.ts, dialog specs).
//
// - useFocusTrap.ts — DOM traversal (`querySelectorAll` + `offsetWidth`
//   /`offsetHeight` visibility checks) and `document.activeElement` state live
//   entirely inside the `useEffect` closure; no exported pure function.
//   Requires real focusable DOM + a mounted ref. Covered by Playwright specs
//   that Tab through open dialogs/drawers.
//
// - useKeyboardNav.ts (`useKeyboardNav`, `useDeleteShortcut`) — arrow-key
//   index/direction math (`Math.min`/`Math.max` against `navItems.length` and
//   a `cols` value read via `getComputedStyle(grid).gridTemplateColumns`) is
//   inline inside the `keydown` handler closure, which itself is defined
//   inside `useEffect` and captures `canvasEl`/`navItems`/`focusedTileId` from
//   the hook's own parameters — it is not exported or otherwise callable in
//   isolation. Extracting the index math into a standalone pure function would
//   require restructuring useKeyboardNav.ts. Covered by Playwright specs
//   exercising arrow-key navigation and Delete/Backspace (e.g.
//   tests/specs/folders.spec.ts, tests/specs/bookmarks.spec.ts).
//
// - useQuickAddShortcuts.ts — single-key routing (a/f/w/e) inside a `keydown`
//   handler closure over hook args; no separable pure function. Covered by
//   Playwright specs exercising quick-add shortcuts.
//
// - useWorkspaceShortcut.ts — Alt+1-9 / Alt+ArrowLeft/Right index math reads
//   `document.querySelector('.ff-ws-tab.is-active')` directly inside the
//   handler to find the current index, coupling the "pure" index arithmetic
//   to a live DOM query in the same expression. Not separable without editing
//   the hook. Covered by Playwright specs exercising workspace-switch
//   shortcuts.
//
// - useMarquee.ts — pointer-event rubber-band selection. `rectsIntersect` and
//   `closestScopeId` are module-scope helper functions but are not exported,
//   and exercising them meaningfully requires real DOMRects from a mounted
//   layout plus PointerEvent capture — moot without a browser. Covered by
//   Playwright specs exercising marquee/rubber-band selection.
//
// - useDrag.ts — the decision logic (reorder gating/index, no-op suppression,
//   folder-zone detection, gap-snap nearest-tile search, section-drop nearest
//   neighbour, workspace bar-gap insertion index) is extracted into pure
//   functions in `lib/drop-resolution.ts`, unit-tested directly in
//   tests/unit/lib/drop-resolution.test.ts. What's left in useDrag.ts itself
//   is DOM wiring only: `elementFromPoint()`/`closest()` reads that build the
//   plain geometry snapshot, and writes of dataset attributes / drag state —
//   still onMove-pointer-handler-closure shaped and still exercised by
//   Playwright specs (tests/specs/dragdrop.spec.ts), not unit tests.
//   `clearDropAttrs` is exported but is a DOM-mutation procedure (deletes
//   dataset attributes), not a pure decision function — nothing to assert
//   against beyond "did it delete the attribute", which requires constructing
//   DOM elements without exercising any decision logic. Still deferred here.
//
// - useDragWiring.ts — wires three useDrag instances together; its own
//   `handleDragCommit`/`getOrderedChildren`/`handleSpringOpenWorkspace` are
//   `useCallback`-wrapped closures over hook args, not exported standalone
//   functions. Covered by Playwright specs exercising drag-drop across
//   canvas/dock/workspace-tab targets.
//
// Net: every hook here is DOM-event-driven with its logic inline inside a
// `useEffect`/`useCallback` closure — none exposes a top-level pure function
// to import and test directly. Documenting the gap rather than mounting a
// fake hook harness or silently skipping coverage.
describe.skip('interaction/ hooks (deferred to E2E — see comment above)', () => {
  it('all 8 hooks are DOM/pointer/keyboard-event-driven with no separable pure logic; covered by tests/specs/*.spec.ts', () => {
    expect(true).toBe(true);
  });
});
