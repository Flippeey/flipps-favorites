import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The browser shim throws at import without a runtime; this stub only has to
// last until the static imports below have evaluated.
vi.hoisted(() => {
  (globalThis as unknown as { chrome?: unknown }).chrome = { runtime: {} };
});

// Icon resolution lives in IndexedDB and has its own tests; stub it so the
// install handler can run in Node.
vi.mock('@/background/icons/icon-service', () => {
  const noop = vi.fn(async () => undefined);
  return {
    getIcon: noop, invalidateIcon: noop, removeFolderIcon: noop, removeIconOverride: noop, searchIcons: noop,
    setFolderIcon: noop, setFolderIconFromUrl: noop, setIconOverride: noop, setIconOverrideFromUrl: noop,
    sweepFolderIcons: noop, sweepGeneratedRecords: noop,
  };
});

import { messageTypes, type AppRequest } from '@/shared/messages';
import { defaultWorkspaceSettings } from '@/shared/storage';
import type { WorkspaceRecord } from '@/shared/models';

// MV3 suspends an idle service worker and starts a fresh one on the next event.
// Only what is in browser storage survives; module state and registered
// listeners do not. The browser fake below lives outside the module graph, so
// re-importing service-worker.ts after vi.resetModules() is a worker restart
// against the same profile.

type Listener = (...args: unknown[]) => unknown;

interface EventFake {
  listeners: Listener[];
  addListener(listener: Listener): void;
}

function createEvent(): EventFake {
  const listeners: Listener[] = [];
  return { listeners, addListener: listener => { listeners.push(listener); } };
}

// Real storage calls settle on a later task, so a listener registered after
// one is registered too late for the event that woke the worker.
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));

function createArea() {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(keys: string | string[] | null) {
      await nextTask();
      if (keys === null) return structuredClone(data);
      const out: Record<string, unknown> = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) if (key in data) out[key] = structuredClone(data[key]);
      return out;
    },
    async set(items: Record<string, unknown>) {
      await nextTask();
      Object.assign(data, structuredClone(items));
    },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  };
}

function installBrowserFake() {
  const local = createArea();
  const sync = createArea();
  const browserProfile = { local, sync };
  const freshRuntime = () => ({
    id: 'test-extension',
    onInstalled: createEvent(),
    onStartup: createEvent(),
    onMessage: createEvent(),
  });
  const chromeFake = {
    runtime: freshRuntime(),
    storage: { local, sync, onChanged: { addListener: () => undefined } },
    bookmarks: { getTree: async () => [{ id: '0', title: '', children: [] }] },
  };
  (globalThis as unknown as { chrome?: unknown }).chrome = chromeFake;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  return {
    ...browserProfile,
    // A new worker gets a new event registry: listeners from the old one are gone.
    resetEvents: () => { chromeFake.runtime = freshRuntime(); },
    get runtime() { return chromeFake.runtime; },
  };
}

async function startWorker(fake: ReturnType<typeof installBrowserFake>) {
  fake.resetEvents();
  vi.resetModules();
  await import('@/background/service-worker');
  return fake.runtime;
}

function send(runtime: ReturnType<typeof installBrowserFake>['runtime'], message: AppRequest): Promise<unknown> {
  return new Promise(resolve => {
    const [listener] = runtime.onMessage.listeners;
    const keptOpen = listener(message, {}, resolve);
    expect(keptOpen).toBe(true);
  });
}

function workspace(id: string, name: string): WorkspaceRecord {
  return { ...defaultWorkspaceSettings, id, name, rootFolderId: '1' };
}

describe('service worker restart', () => {
  let fake: ReturnType<typeof installBrowserFake>;

  beforeEach(() => {
    fake = installBrowserFake();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
  });

  it('registers its event listeners synchronously while the module evaluates', async () => {
    // A listener added after an await is missed by the event that woke the
    // worker, so the wake-up message would go unanswered.
    const runtime = await startWorker(fake);
    expect(runtime.onMessage.listeners).toHaveLength(1);
    expect(runtime.onInstalled.listeners).toHaveLength(1);
    expect(runtime.onStartup.listeners).toHaveLength(1);
  });

  it('re-registers its listeners in every new worker', async () => {
    await startWorker(fake);
    const restarted = await startWorker(fake);
    expect(restarted.onMessage.listeners).toHaveLength(1);
    expect(restarted.onStartup.listeners).toHaveLength(1);
  });

  it('answers the message that woke it', async () => {
    const runtime = await startWorker(fake);
    await expect(send(runtime, { type: messageTypes.ping })).resolves.toEqual({ ok: true, context: 'background' });
  });

  it('keeps a settings change made before the worker was suspended', async () => {
    const before = await startWorker(fake);
    await send(before, { type: messageTypes.patchSettings, patch: { showClock: true, themeMode: 'dark' } });

    const after = await startWorker(fake);
    const response = await send(after, { type: messageTypes.getSettings }) as { settings: { showClock: boolean; themeMode: string } };
    expect(response.settings.showClock).toBe(true);
    expect(response.settings.themeMode).toBe('dark');
  });

  it('keeps workspaces created and patched before the worker was suspended', async () => {
    const before = await startWorker(fake);
    await send(before, { type: messageTypes.createWorkspace, workspace: workspace('w1', 'Work') });
    await send(before, { type: messageTypes.createWorkspace, workspace: workspace('w2', 'Home') });
    await send(before, { type: messageTypes.patchWorkspace, id: 'w1', patch: { name: 'Office' } });

    const after = await startWorker(fake);
    const response = await send(after, { type: messageTypes.getWorkspaces }) as { workspaces: WorkspaceRecord[] };
    expect(response.workspaces.map(w => [w.id, w.name]).sort()).toEqual([['w1', 'Office'], ['w2', 'Home']]);
  });

  it('keeps a deleted workspace deleted', async () => {
    const before = await startWorker(fake);
    await send(before, { type: messageTypes.createWorkspace, workspace: workspace('w1', 'Work') });
    await send(before, { type: messageTypes.deleteWorkspace, id: 'w1' });

    const after = await startWorker(fake);
    const response = await send(after, { type: messageTypes.getWorkspaces }) as { workspaces: WorkspaceRecord[] };
    expect(response.workspaces).toEqual([]);
  });

  it('keeps bookmark usage recorded before the worker was suspended', async () => {
    const before = await startWorker(fake);
    const recorded = await send(before, { type: messageTypes.recordBookmarkUse, bookmarkId: 'b1' }) as { usedAt: number };

    const after = await startWorker(fake);
    const response = await send(after, { type: messageTypes.getBookmarkUsage }) as { usage: Record<string, number> };
    expect(response.usage).toEqual({ b1: recorded.usedAt });
  });

  it('runs the one-time storage migrations only once across restarts', async () => {
    fake.sync.data.workspaces = { legacy: workspace('legacy', 'Legacy') };

    const first = await startWorker(fake);
    await send(first, { type: messageTypes.getWorkspaces });
    expect(fake.sync.data).not.toHaveProperty('workspaces');

    // A stale peer re-writing the legacy aggregate key must not be re-split
    // by the next worker: the persisted marker, not module state, gates it.
    fake.sync.data.workspaces = { ghost: workspace('ghost', 'Ghost') };
    const second = await startWorker(fake);
    const response = await send(second, { type: messageTypes.getWorkspaces }) as { workspaces: WorkspaceRecord[] };
    expect(response.workspaces.map(w => w.id)).toEqual(['legacy']);
  });

  it('keeps the onboarding prompt pending when the worker restarts after install', async () => {
    const runtime = await startWorker(fake);
    await runtime.onInstalled.listeners[0]({ reason: 'install' });

    await startWorker(fake);
    const { readOnboardingState } = await import('@/shared/storage');
    const state = await readOnboardingState();
    expect(state.status).toBe('pending');
  });
});
