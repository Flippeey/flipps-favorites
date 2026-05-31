export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function firstSuccessful<T>(promises: Array<Promise<T | null>>): Promise<T | null> {
  if (!promises.length) return null;
  return new Promise(resolve => {
    let pending = promises.length;
    let settled = false;
    for (const promise of promises) {
      promise.then(value => {
        if (!settled && value !== null && value !== undefined) {
          settled = true;
          resolve(value);
        }
      }).catch(() => undefined).finally(() => {
        pending -= 1;
        if (pending === 0 && !settled) {
          settled = true;
          resolve(null);
        }
      });
    }
  });
}

export class ResolutionSemaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.active += 1;
    return () => this.release();
  }

  private release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}
