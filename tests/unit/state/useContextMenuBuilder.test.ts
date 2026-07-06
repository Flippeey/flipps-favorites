import { describe, expect, it } from 'vitest';

// useContextMenuBuilder (src/newtab/state/useContextMenuBuilder.ts) is a
// React hook: `buildContextMenuItems` and friends are wrapped in
// `useCallback`, and the hook is on this task's read-only file list (t8
// handoff: touch only the 3 new test files; the hook itself belongs to a
// different wave/task).
//
// `buildContextMenuItems`'s body is a plain function of its closed-over args
// (no hooks called inside it), so in principle it's separable — but lifting
// it out from under `useCallback` into a standalone exported pure function
// would mean editing useContextMenuBuilder.ts, which is out of scope here.
// Calling the hook itself requires a React dispatcher (jsdom / react-test-
// renderer / @testing-library), none of which are installed, and adding one
// is explicitly out of scope for issue #54 ("DECIDED: no RTL / no
// component-testing dep").
//
// Net: the menu-item branches this task called out (single bookmark, single
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
