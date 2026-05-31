export type DockMode = 'always' | 'hover' | 'hidden';

export function resolveDockMode(showDock: boolean, autoHideDock: boolean): DockMode {
  if (!showDock) return 'hidden';
  return autoHideDock ? 'hover' : 'always';
}
