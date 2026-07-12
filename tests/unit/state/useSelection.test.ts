import { describe, expect, it } from 'vitest';

// useSelection (src/newtab/state/useSelection.ts) is a React hook: its
// selection-transition logic (Ctrl/Cmd toggle, Shift range-select, scope
// reset) lives inside `useState`/`useCallback`/`useRef` closures, and the
// hook itself is on this task's read-only file list (t8 handoff: touch only
// the 3 new test files, hooks stay untouched).
//
// Calling a hook outside a component tree throws (no dispatcher) — there is
// no jsdom / react-test-renderer / @testing-library dependency in this repo,
// and adding one is explicitly out of scope for issue #54 ("DECIDED: no RTL
// / no component-testing dep"). Extracting the transition logic into a
// standalone pure function would require editing useSelection.ts, which is
// also out of scope here (read-only; a different wave/task owns it).
//
// Net: this hook's selection-model transitions (single click clears, Ctrl
// toggles within scope, Shift range-selects from the last-clicked anchor,
// scope change resets the id set) are irreducibly DOM/React-runtime-bound
// under these constraints and are covered instead by
// tests/specs/selection.spec.ts (Playwright, drives real clicks/marquee
// against the built extension). Documenting the gap here rather than
// mounting a fake hook harness or silently duplicating the logic.
describe.skip('useSelection (deferred to E2E — see comment above)', () => {
  it('selection-model transitions are covered by tests/specs/selection.spec.ts', () => {
    expect(true).toBe(true);
  });
});
