// Unit tests for OnboardingState v2 normalize logic.
// Tests run in isolation via dynamic import (chrome fake installed before module load).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchetypeId } from '@/shared/organization-templates';

// ─────────────────────────────────────────────────────────────────────────────
// Chrome storage fake — must be installed BEFORE the module under test imports.
// Mirrors the pattern in storage-workspace-migration.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

interface StorageAreaFake {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function createAreaFake(seed: Record<string, unknown> = {}): { api: StorageAreaFake; data: Record<string, unknown> } {
  const data: Record<string, unknown> = { ...seed };
  const api: StorageAreaFake = {
    async get(keys) {
      if (keys === null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of list) {
        if (key in data) out[key] = data[key];
      }
      return out;
    },
    async set(items) {
      Object.assign(data, items);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) delete data[key];
    },
  };
  return { api, data };
}

function installChromeFake(localSeed: Record<string, unknown> = {}): void {
  const local = createAreaFake(localSeed);
  const sync = createAreaFake({});
  const chromeFake = {
    runtime: { id: 'test-extension' },
    storage: {
      local: local.api,
      sync: sync.api,
      onChanged: { addListener: () => undefined },
    },
  };
  (globalThis as unknown as { chrome?: unknown }).chrome = chromeFake;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
}

async function importStorage(): Promise<typeof import('@/shared/storage')> {
  vi.resetModules();
  return import('@/shared/storage');
}

afterEach(() => {
  vi.resetModules();
  (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeOnboardingState — exported indirectly via readOnboardingState
// We test it by seeding storage with a raw record and reading back, which runs
// deserialize() → normalizeOnboardingState().
// ─────────────────────────────────────────────────────────────────────────────

const ONBOARDING_KEY = 'onboarding-state';

describe('OnboardingState v2 normalize — v1 record migration', () => {
  it('v1 record (no archetype fields) normalizes with null defaults for both new fields', async () => {
    installChromeFake({
      [ONBOARDING_KEY]: {
        version: 1,
        status: 'completed',
        updatedAt: 1000,
        completedAt: 1000,
        skippedAt: null,
      },
    });

    const storage = await importStorage();
    const state = await storage.readOnboardingState();

    // New fields must default to null — a v1 record has no archetype data.
    expect(state.recommendedArchetype).toBeNull();
    expect(state.chosenArchetype).toBeNull();
    // Existing fields must round-trip unchanged.
    expect(state.status).toBe('completed');
    expect(state.updatedAt).toBe(1000);
    expect(state.completedAt).toBe(1000);
    expect(state.skippedAt).toBeNull();
  });

  it('v1 record with status=skipped normalizes correctly with null archetype defaults', async () => {
    installChromeFake({
      [ONBOARDING_KEY]: {
        version: 1,
        status: 'skipped',
        updatedAt: 2000,
        completedAt: null,
        skippedAt: 2000,
      },
    });

    const storage = await importStorage();
    const state = await storage.readOnboardingState();

    expect(state.recommendedArchetype).toBeNull();
    expect(state.chosenArchetype).toBeNull();
    expect(state.status).toBe('skipped');
    expect(state.skippedAt).toBe(2000);
  });

  it('v1 record with status=pending normalizes correctly with null archetype defaults', async () => {
    installChromeFake({
      [ONBOARDING_KEY]: {
        version: 1,
        status: 'pending',
        updatedAt: 3000,
        completedAt: null,
        skippedAt: null,
      },
    });

    const storage = await importStorage();
    const state = await storage.readOnboardingState();

    expect(state.recommendedArchetype).toBeNull();
    expect(state.chosenArchetype).toBeNull();
    expect(state.status).toBe('pending');
  });
});

describe('OnboardingState v2 — v2 round-trip', () => {
  it('v2 record with non-null archetype fields round-trips without data loss', async () => {
    installChromeFake({
      [ONBOARDING_KEY]: {
        version: 2,
        status: 'completed',
        updatedAt: 5000,
        completedAt: 5000,
        skippedAt: null,
        recommendedArchetype: 'power-user' satisfies ArchetypeId,
        chosenArchetype: 'researcher' satisfies ArchetypeId,
      },
    });

    const storage = await importStorage();
    const state = await storage.readOnboardingState();

    expect(state.recommendedArchetype).toBe('power-user');
    expect(state.chosenArchetype).toBe('researcher');
    expect(state.status).toBe('completed');
  });

  it('v2 record with chosenArchetype=skipped round-trips correctly', async () => {
    installChromeFake({
      [ONBOARDING_KEY]: {
        version: 2,
        status: 'completed',
        updatedAt: 6000,
        completedAt: 6000,
        skippedAt: null,
        recommendedArchetype: 'hoarder' satisfies ArchetypeId,
        chosenArchetype: 'skipped',
      },
    });

    const storage = await importStorage();
    const state = await storage.readOnboardingState();

    expect(state.recommendedArchetype).toBe('hoarder');
    expect(state.chosenArchetype).toBe('skipped');
  });

  it('v2 record with null archetype fields round-trips as null', async () => {
    installChromeFake({
      [ONBOARDING_KEY]: {
        version: 2,
        status: 'completed',
        updatedAt: 7000,
        completedAt: 7000,
        skippedAt: null,
        recommendedArchetype: null,
        chosenArchetype: null,
      },
    });

    const storage = await importStorage();
    const state = await storage.readOnboardingState();

    expect(state.recommendedArchetype).toBeNull();
    expect(state.chosenArchetype).toBeNull();
  });
});

describe('OnboardingState v2 — malformed input narrowing', () => {
  it('completely empty record falls back to defaults (null archetypes, completed status)', async () => {
    installChromeFake({ [ONBOARDING_KEY]: {} });

    const storage = await importStorage();
    const state = await storage.readOnboardingState();

    expect(state.recommendedArchetype).toBeNull();
    expect(state.chosenArchetype).toBeNull();
    // Default status is 'completed' per defaultOnboardingState.
    expect(state.status).toBe('completed');
  });

  it('invalid recommendedArchetype value is narrowed to null', async () => {
    installChromeFake({
      [ONBOARDING_KEY]: {
        version: 2,
        status: 'completed',
        updatedAt: 8000,
        completedAt: 8000,
        skippedAt: null,
        recommendedArchetype: 'invalid-archetype',
        chosenArchetype: 42,
      },
    });

    const storage = await importStorage();
    const state = await storage.readOnboardingState();

    expect(state.recommendedArchetype).toBeNull();
    expect(state.chosenArchetype).toBeNull();
  });

  it('valid chosenArchetype values are accepted (all ArchetypeId + skipped)', async () => {
    const validChoices: (ArchetypeId | 'skipped')[] = ['hoarder', 'power-user', 'casual', 'researcher', 'skipped'];

    for (const choice of validChoices) {
      installChromeFake({
        [ONBOARDING_KEY]: {
          version: 2,
          status: 'completed',
          updatedAt: 9000,
          completedAt: 9000,
          skippedAt: null,
          recommendedArchetype: null,
          chosenArchetype: choice,
        },
      });

      const storage = await importStorage();
      const state = await storage.readOnboardingState();
      expect(state.chosenArchetype).toBe(choice);
    }
  });

  it('valid recommendedArchetype values (ArchetypeId minus skipped) are accepted', async () => {
    const validRecommended: ArchetypeId[] = ['hoarder', 'power-user', 'casual', 'researcher'];

    for (const arch of validRecommended) {
      installChromeFake({
        [ONBOARDING_KEY]: {
          version: 2,
          status: 'completed',
          updatedAt: 10000,
          completedAt: 10000,
          skippedAt: null,
          recommendedArchetype: arch,
          chosenArchetype: null,
        },
      });

      const storage = await importStorage();
      const state = await storage.readOnboardingState();
      expect(state.recommendedArchetype).toBe(arch);
    }
  });

  it('null stored value produces defaults', async () => {
    installChromeFake({ [ONBOARDING_KEY]: null });

    const storage = await importStorage();
    const state = await storage.readOnboardingState();

    expect(state.recommendedArchetype).toBeNull();
    expect(state.chosenArchetype).toBeNull();
    expect(state.status).toBe('completed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// markOnboardingCompleted wiring — the archetypeInfo param must reach storage.
// These tests prove the full write→read round-trip that App.tsx must invoke.
// The PR review flagged that App called markOnboardingCompleted() with NO
// argument, leaving recommendedArchetype and chosenArchetype permanently null.
// ─────────────────────────────────────────────────────────────────────────────

describe('markOnboardingCompleted — archetypeInfo wiring', () => {
  it('persists chosen + recommended archetype when called with archetypeInfo', async () => {
    installChromeFake({});

    const storage = await importStorage();
    await storage.markOnboardingCompleted({
      recommendedArchetype: 'power-user',
      chosenArchetype: 'researcher',
    });

    const state = await storage.readOnboardingState();
    expect(state.status).toBe('completed');
    expect(state.recommendedArchetype).toBe('power-user');
    expect(state.chosenArchetype).toBe('researcher');
  });

  it('persists chosenArchetype="skipped" when the user dismissed the template step', async () => {
    installChromeFake({});

    const storage = await importStorage();
    await storage.markOnboardingCompleted({
      recommendedArchetype: 'casual',
      chosenArchetype: 'skipped',
    });

    const state = await storage.readOnboardingState();
    expect(state.status).toBe('completed');
    expect(state.recommendedArchetype).toBe('casual');
    expect(state.chosenArchetype).toBe('skipped');
  });

  it('called with NO argument (the pre-fix App.tsx call) leaves both archetype fields null', async () => {
    installChromeFake({});

    const storage = await importStorage();
    // This documents the broken pre-fix behaviour so any regression is caught.
    await storage.markOnboardingCompleted();

    const state = await storage.readOnboardingState();
    expect(state.status).toBe('completed');
    expect(state.recommendedArchetype).toBeNull();
    expect(state.chosenArchetype).toBeNull();
  });

  it('persists null recommendedArchetype when classifier returned no match', async () => {
    installChromeFake({});

    const storage = await importStorage();
    await storage.markOnboardingCompleted({
      recommendedArchetype: null,
      chosenArchetype: 'hoarder',
    });

    const state = await storage.readOnboardingState();
    expect(state.recommendedArchetype).toBeNull();
    expect(state.chosenArchetype).toBe('hoarder');
  });

  it('each valid ArchetypeId can be chosen and persists correctly', async () => {
    const choices: Array<'hoarder' | 'power-user' | 'casual' | 'researcher'> = [
      'hoarder', 'power-user', 'casual', 'researcher',
    ];
    for (const choice of choices) {
      installChromeFake({});
      const storage = await importStorage();
      await storage.markOnboardingCompleted({
        recommendedArchetype: null,
        chosenArchetype: choice,
      });
      const state = await storage.readOnboardingState();
      expect(state.chosenArchetype).toBe(choice);
    }
  });
});
