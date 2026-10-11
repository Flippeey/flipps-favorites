import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// declarativeNetRequest session rules outlive the MV3 service worker: Chrome
// keeps them until the browser closes, while every module-level variable is
// reset when the worker is suspended and restarted. This fake keeps its rule
// table outside the module graph so a vi.resetModules() re-import behaves like
// a worker restart against the same browser session, and it rejects duplicate
// rule ids the way Chrome does.

interface SessionRule {
  id: number;
  condition: { urlFilter: string };
}

function installDnrFake() {
  const rules = new Map<number, SessionRule>();
  const updateSessionRules = vi.fn(async (options: { addRules?: SessionRule[]; removeRuleIds?: number[] }) => {
    for (const id of options.removeRuleIds ?? []) rules.delete(id);
    for (const rule of options.addRules ?? []) {
      if (rules.has(rule.id)) throw new Error(`Rule with id ${rule.id} does not have a unique ID.`);
    }
    for (const rule of options.addRules ?? []) rules.set(rule.id, rule);
  });
  const getSessionRules = vi.fn(async () => [...rules.values()]);
  (globalThis as unknown as { chrome?: unknown }).chrome = {
    runtime: { id: 'test-extension' },
    declarativeNetRequest: { updateSessionRules, getSessionRules },
  };
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/125.0' });
  return { rules, updateSessionRules };
}

async function startWorker(): Promise<typeof import('@/background/icons/cors-bypass')> {
  vi.resetModules();
  return import('@/background/icons/cors-bypass');
}

describe('withCorsBypass across a service-worker restart', () => {
  let dnr: ReturnType<typeof installDnrFake>;

  beforeEach(() => {
    dnr = installDnrFake();
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
  });

  it('removes its rule once the wrapped fetch settles', async () => {
    const { withCorsBypass } = await startWorker();
    let seenDuringFetch = 0;
    await withCorsBypass('||a.example/', async () => { seenDuringFetch = dnr.rules.size; });
    expect(seenDuringFetch).toBe(1);
    expect(dnr.rules.size).toBe(0);
  });

  it('still injects the CORS header after a worker killed mid-fetch leaked its rule', async () => {
    const first = await startWorker();
    // The worker is terminated while the fetch is pending, so the finally
    // block that removes the rule never runs.
    void first.withCorsBypass('||leaked.example/', () => new Promise<never>(() => undefined));
    await vi.waitFor(() => expect(dnr.rules.size).toBe(1));

    const second = await startWorker();
    let ruleForThisFetch: SessionRule | undefined;
    await second.withCorsBypass('||fresh.example/', async () => {
      ruleForThisFetch = [...dnr.rules.values()].find(rule => rule.condition.urlFilter === '||fresh.example/');
    });

    expect(ruleForThisFetch).toBeDefined();
  });

  it('clears rules leaked by a previous worker so they stop rewriting headers', async () => {
    const first = await startWorker();
    void first.withCorsBypass('||leaked.example/', () => new Promise<never>(() => undefined));
    await vi.waitFor(() => expect(dnr.rules.size).toBe(1));

    const second = await startWorker();
    await second.withCorsBypass('||fresh.example/', async () => undefined);

    expect([...dnr.rules.values()].map(rule => rule.condition.urlFilter)).toEqual([]);
  });

  it('keeps rule ids unique across concurrent fetches after a restart', async () => {
    const first = await startWorker();
    void first.withCorsBypass('||leaked.example/', () => new Promise<never>(() => undefined));
    await vi.waitFor(() => expect(dnr.rules.size).toBe(1));

    const second = await startWorker();
    const filters: string[] = [];
    await Promise.all(['||a.example/', '||b.example/', '||c.example/'].map(filter =>
      second.withCorsBypass(filter, async () => {
        if ([...dnr.rules.values()].some(rule => rule.condition.urlFilter === filter)) filters.push(filter);
      })));

    expect(filters.sort()).toEqual(['||a.example/', '||b.example/', '||c.example/']);
  });
});
