type PerfDetailValue = string | number | boolean | null | undefined;

export interface PerfEvent {
  name: string;
  duration: number;
  detail?: Record<string, PerfDetailValue>;
  timestamp: number;
}

declare global {
  interface Window {
    __flippsPerf?: {
      enabled?: boolean;
      emit?: (event: PerfEvent) => void;
      events?: PerfEvent[];
    };
  }
}

const PERF_STORAGE_KEY = 'flipps:favorites:perf';

export function measureSync<T>(name: string, detail: Record<string, PerfDetailValue> | undefined, action: () => T): T {
  if (!isPerfEnabled()) {
    return action();
  }

  const start = performance.now();
  try {
    return action();
  } finally {
    emitPerfEvent(name, performance.now() - start, detail);
  }
}

export async function measureAsync<T>(name: string, detail: Record<string, PerfDetailValue> | undefined, action: () => Promise<T>): Promise<T> {
  if (!isPerfEnabled()) {
    return action();
  }

  const start = performance.now();
  try {
    return await action();
  } finally {
    emitPerfEvent(name, performance.now() - start, detail);
  }
}

function isPerfEnabled(): boolean {
  if (window.__flippsPerf?.enabled) {
    return true;
  }

  try {
    return window.localStorage.getItem(PERF_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function emitPerfEvent(name: string, duration: number, detail?: Record<string, PerfDetailValue>): void {
  const event: PerfEvent = {
    name,
    duration,
    detail,
    timestamp: Date.now(),
  };

  window.__flippsPerf?.events?.push(event);
  window.__flippsPerf?.emit?.(event);
  window.dispatchEvent(new CustomEvent<PerfEvent>('flipps:perf', { detail: event }));
  console.debug(`[flipps:perf] ${name} ${duration.toFixed(2)}ms`, detail ?? {});
}
