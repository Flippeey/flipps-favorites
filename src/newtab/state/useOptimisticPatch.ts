// Pure helper for the repeated optimistic-write pattern used across App.tsx.
// apply(): push a value into React state. persist(): the async source of truth.
export async function runOptimistic<T>(args: {
  optimistic: T;
  apply: (value: T) => void;
  persist: () => Promise<T>;
}): Promise<void> {
  args.apply(args.optimistic);
  try {
    const reconciled = await args.persist();
    args.apply(reconciled);
  } catch {
    // keep optimistic value
  }
}
