import { useEffect } from 'react';
import type { WorkspaceRecord } from '../../shared/messages';

// Alt+1-9 switches workspace (only when no modifier conflicts and no input is focused).
export function useWorkspaceShortcut(workspaces: WorkspaceRecord[], onSwitch: (id: string) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) return;
      const digit = parseInt(e.key, 10);
      if (Number.isNaN(digit)) return;
      if (digit >= 1 && digit <= 9 && digit <= workspaces.length) {
        e.preventDefault();
        onSwitch(workspaces[digit - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [workspaces, onSwitch]);
}
