import type { PushToastInput } from '../state/useToasts';

/** Effects the module needs but must not import directly (App owns the real implementations). */
export interface UndoableMutationDeps {
  refreshTree: () => Promise<void>;
  pushToast: (input: PushToastInput) => void;
}

/** Reverses a successful mutation. `failedMessage` is shown if `run` itself throws. */
export interface UndoStep {
  run: () => Promise<void>;
  failedMessage: string;
}

/** Success toast to show, and whether it offers Undo. */
export interface MutationOutcome {
  message: string;
  undo?: UndoStep;
}

export interface UndoableMutationSpec<T> {
  /** Does the mutation. May throw — see `performFailedMessage`. */
  perform: () => Promise<T>;
  /**
   * Builds the success toast from perform's result. Return `null` to skip the
   * toast entirely (e.g. a relocate that landed back where it started).
   */
  onSuccess: (result: T) => MutationOutcome | null;
  /**
   * Shown (as an error toast) if `perform` throws, and the throw is swallowed.
   * Omit to let the rejection propagate instead — for call sites where a
   * surrounding dialog owns its own inline error display.
   */
  performFailedMessage?: string;
  /** Runs `refreshTree` even when `perform` throws. Default false. */
  refreshOnPerformFailure?: boolean;
  /** Runs `refreshTree` after a successful `perform`. Default true — set false when the caller already refreshes unconditionally itself. */
  refreshOnSuccess?: boolean;
}

/**
 * Owns the perform → refresh → toast(with wired Undo) → error-toast choreography
 * shared by every undoable tree mutation (delete, move, relocate-on-drop). Callers
 * supply the mutation itself and its reversal; this module supplies the sequencing
 * and the Undo button's own try/catch so it isn't hand-copied at each call site.
 */
export async function runUndoableMutation<T>(
  deps: UndoableMutationDeps,
  spec: UndoableMutationSpec<T>,
): Promise<T | undefined> {
  const { refreshTree, pushToast } = deps;
  const { perform, onSuccess, performFailedMessage, refreshOnPerformFailure = false, refreshOnSuccess = true } = spec;

  let result: T;
  try {
    result = await perform();
  } catch (err) {
    if (refreshOnPerformFailure) await refreshTree();
    if (performFailedMessage) {
      pushToast({ kind: 'error', message: performFailedMessage });
      return undefined;
    }
    throw err;
  }

  if (refreshOnSuccess) await refreshTree();

  const outcome = onSuccess(result);
  if (!outcome) return result;

  const { undo } = outcome;
  pushToast({
    kind: 'info',
    message: outcome.message,
    action: undo
      ? {
          label: 'Undo',
          onClick: () => {
            void (async () => {
              try {
                await undo.run();
                await refreshTree();
              } catch {
                pushToast({ kind: 'error', message: undo.failedMessage });
              }
            })();
          },
        }
      : undefined,
  });

  return result;
}
