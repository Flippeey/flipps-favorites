import { describe, expect, it } from 'vitest';
import { resolveDockMode } from '../../../src/newtab/lib/dock-mode';

describe('resolveDockMode', () => {
  it('maps the three states', () => {
    expect(resolveDockMode(false, true)).toBe('hidden');
    expect(resolveDockMode(false, false)).toBe('hidden');
    expect(resolveDockMode(true, true)).toBe('hover');
    expect(resolveDockMode(true, false)).toBe('always');
  });
});
