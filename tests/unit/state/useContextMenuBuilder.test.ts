import { describe, expect, it } from 'vitest';

// useContextMenuBuilder (src/newtab/state/useContextMenuBuilder.ts) is a
// React hook: `buildContextMenuItems` and friends are wrapped in
// `useCallback`.
//
// `buildContextMenuItems`'s body is a plain function of its closed-over args
// (no hooks called inside it), so in principle it's separable — but lifting
// it out from under `useCallback` into a standalone exported pure function
// would mean restructuring useContextMenuBuilder.ts.
// Calling the hook itself requires a React dispatcher (jsdom / react-test-
// renderer / @testing-library), none of which are installed, and adding one
// is deliberately avoided (see .claude/testing.md).
//
// Net: the menu-item branches (single bookmark, single
// folder, multi-select, folder-in-overlay/section) are irreducibly
// DOM/React-runtime-bound under these constraints and are covered instead by
// tests/specs/context-menu.spec.ts (Playwright, drives real right-clicks
// against the built extension). Documenting the gap here rather than
// mounting a fake hook harness or silently duplicating the logic.
describe.skip('useContextMenuBuilder (deferred to E2E — see comment above)', () => {
  it('menu-item construction across selection shapes is covered by tests/specs/context-menu.spec.ts', () => {
    expect(true).toBe(true);
  });
});
