import { describe, expect, it, vi } from 'vitest';
import { runOptimistic } from '../../../src/newtab/state/useOptimisticPatch';

describe('runOptimistic', () => {
  it('applies optimistic value, then reconciles with server result', async () => {
    const apply = vi.fn();
    const persist = vi.fn().mockResolvedValue({ v: 'server' });
    await runOptimistic({ optimistic: { v: 'local' }, apply, persist });
    expect(apply).toHaveBeenNthCalledWith(1, { v: 'local' });
    expect(apply).toHaveBeenNthCalledWith(2, { v: 'server' });
  });

  it('keeps the optimistic value when persist rejects', async () => {
    const apply = vi.fn();
    const persist = vi.fn().mockRejectedValue(new Error('offline'));
    await runOptimistic({ optimistic: { v: 'local' }, apply, persist });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ v: 'local' });
  });
});
