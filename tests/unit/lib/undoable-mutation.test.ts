import { describe, expect, it, vi } from 'vitest';
import { runUndoableMutation, type UndoableMutationDeps } from '@/newtab/lib/undoable-mutation';
import type { PushToastInput, ToastAction } from '@/newtab/state/useToasts';

function makeDeps() {
  const refreshTree = vi.fn(async (): Promise<void> => { /* fake */ });
  const pushToast = vi.fn((_input: PushToastInput): void => { /* fake */ });
  return { refreshTree, pushToast } satisfies UndoableMutationDeps;
}

function lastToast(pushToast: ReturnType<typeof vi.fn>): PushToastInput {
  const calls = pushToast.mock.calls;
  return calls[calls.length - 1]![0] as PushToastInput;
}

describe('runUndoableMutation', () => {
  // WHY: this is the base case every call site relies on — perform runs, the
  // tree refreshes, and the success toast carries a working Undo action.
  // If the sequencing or the Undo wiring regresses, this must fail.
  it('refreshes and shows an Undo toast on success', async () => {
    const deps = makeDeps();
    const perform = vi.fn().mockResolvedValue('ok');
    const undoRun = vi.fn().mockResolvedValue(undefined);

    await runUndoableMutation(deps, {
      perform,
      onSuccess: () => ({ message: 'Deleted “X”', undo: { run: undoRun, failedMessage: 'Couldn’t restore.' } }),
    });

    expect(deps.refreshTree).toHaveBeenCalledTimes(1);
    const toast = lastToast(deps.pushToast);
    expect(toast).toMatchObject({ kind: 'info', message: 'Deleted “X”' });
    expect(toast.action?.label).toBe('Undo');

    // Undo reverses the mutation and refreshes again.
    (toast.action as ToastAction).onClick();
    await vi.waitFor(() => expect(undoRun).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(deps.refreshTree).toHaveBeenCalledTimes(2));
    expect(deps.pushToast).toHaveBeenCalledTimes(1); // no error toast pushed
  });

  // WHY: a perform that resolves without anything worth reporting (e.g. a
  // relocate whose destination equals the source) must skip the toast — but
  // still refresh, since the mutation may have touched other items in the batch.
  it('skips the toast when onSuccess returns null, but still refreshes', async () => {
    const deps = makeDeps();
    await runUndoableMutation(deps, {
      perform: () => Promise.resolve('ok'),
      onSuccess: () => null,
    });
    expect(deps.refreshTree).toHaveBeenCalledTimes(1);
    expect(deps.pushToast).not.toHaveBeenCalled();
  });

  // WHY: sites that already refresh unconditionally after this call (the
  // create-folder-and-move flow refreshes regardless of whether a move
  // happened) must be able to opt out of the module's own refresh, or the
  // tree would be fetched twice for one user action.
  it('does not refresh when refreshOnSuccess is false', async () => {
    const deps = makeDeps();
    await runUndoableMutation(deps, {
      perform: () => Promise.resolve('ok'),
      onSuccess: () => ({ message: 'Moved 1 item' }),
      refreshOnSuccess: false,
    });
    expect(deps.refreshTree).not.toHaveBeenCalled();
    expect(lastToast(deps.pushToast).action).toBeUndefined();
  });

  // WHY: a delete/move that fails outright must surface an error toast and
  // must NOT offer an Undo — there is nothing to undo, and no refresh is
  // needed since nothing changed.
  it('pushes an error toast and no Undo when perform fails and a message is given', async () => {
    const deps = makeDeps();
    const perform = vi.fn().mockRejectedValue(new Error('boom'));

    const result = await runUndoableMutation(deps, {
      perform,
      onSuccess: () => ({ message: 'should not run' }),
      performFailedMessage: 'Couldn’t delete “X”.',
    });

    expect(result).toBeUndefined();
    expect(deps.refreshTree).not.toHaveBeenCalled();
    expect(deps.pushToast).toHaveBeenCalledTimes(1);
    expect(lastToast(deps.pushToast)).toMatchObject({ kind: 'error', message: 'Couldn’t delete “X”.' });
  });

  // WHY: some call sites (e.g. a drop inside a folder-delete confirm dialog)
  // rely on the rejection propagating so the dialog's own inline error UI can
  // show it — the module must not silently swallow the failure there.
  it('rethrows when perform fails and no performFailedMessage is given', async () => {
    const deps = makeDeps();
    const err = new Error('boom');
    await expect(
      runUndoableMutation(deps, {
        perform: () => Promise.reject(err),
        onSuccess: () => null,
      }),
    ).rejects.toBe(err);
    expect(deps.pushToast).not.toHaveBeenCalled();
  });

  // WHY: a drag commit refreshes the tree even when the relocate itself threw
  // partway through a multi-item batch, so the UI reflects whatever subset
  // did move — losing this would leave stale tiles on screen after a failure.
  it('refreshes on perform failure when refreshOnPerformFailure is set, then still rethrows', async () => {
    const deps = makeDeps();
    const err = new Error('boom');
    await expect(
      runUndoableMutation(deps, {
        perform: () => Promise.reject(err),
        onSuccess: () => null,
        refreshOnPerformFailure: true,
      }),
    ).rejects.toBe(err);
    expect(deps.refreshTree).toHaveBeenCalledTimes(1);
  });

  // WHY: if reversing the mutation itself fails (e.g. the browser rejects
  // re-creating the bookmark), the user must be told via an error toast
  // rather than the Undo button silently doing nothing — and a failed undo
  // must not be followed by a refresh, since nothing was actually restored.
  it('shows an error toast when undo itself fails, without a second refresh', async () => {
    const deps = makeDeps();
    const undoRun = vi.fn().mockRejectedValue(new Error('undo failed'));

    await runUndoableMutation(deps, {
      perform: () => Promise.resolve('ok'),
      onSuccess: () => ({ message: 'Deleted “X”', undo: { run: undoRun, failedMessage: 'Couldn’t restore the bookmark.' } }),
    });

    const toast = lastToast(deps.pushToast);
    (toast.action as ToastAction).onClick();

    await vi.waitFor(() => expect(deps.pushToast).toHaveBeenCalledTimes(2));
    expect(lastToast(deps.pushToast)).toMatchObject({ kind: 'error', message: 'Couldn’t restore the bookmark.' });
    expect(deps.refreshTree).toHaveBeenCalledTimes(1); // only the initial post-perform refresh
  });
});
