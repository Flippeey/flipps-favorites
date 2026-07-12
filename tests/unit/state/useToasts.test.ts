import { describe, expect, it } from 'vitest';

// useToasts (src/newtab/state/useToasts.ts) is a React hook: `pushToast` /
// `dismissToast` and the auto-dismiss timers live inside `useState` /
// `useCallback` / `useRef` closures, and the hook is on this task's
// read-only file list (t8 handoff: touch only the 3 new test files; the
// hook itself belongs to a different wave/task).
//
// Its queue behavior (enqueue with a generated id, auto-dismiss after
// duration ?? 5000/7000ms by kind, manual dismiss clears the pending timer)
// is the closest of the three target hooks to a pure reducer, but the state
// transitions and timer bookkeeping only run through React's `useState`
// dispatcher — calling the hook outside a component tree throws. No jsdom /
// react-test-renderer / @testing-library dependency exists in this repo, and
// adding one is explicitly out of scope for issue #54 ("DECIDED: no RTL / no
// component-testing dep"). Extracting the enqueue/dismiss logic into a
// standalone pure function (mirroring the useOptimisticPatch.ts pattern)
// would require editing useToasts.ts, which is also out of scope here.
//
// Net: irreducibly DOM/React-runtime-bound under these constraints. Toast
// enqueue/auto-dismiss/dismiss-with-action behavior is covered instead by
// the Playwright specs that trigger toasts as a side effect of user flows
// (e.g. tests/specs/undo-move.spec.ts, tests/specs/dragdrop.spec.ts).
// Documenting the gap here rather than mounting a fake hook harness or
// silently duplicating the logic.
describe.skip('useToasts (deferred to E2E — see comment above)', () => {
  it('toast queue behavior is covered by tests/specs/undo-move.spec.ts and tests/specs/dragdrop.spec.ts', () => {
    expect(true).toBe(true);
  });
});
