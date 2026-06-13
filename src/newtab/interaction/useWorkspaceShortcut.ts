import { useEffect } from 'react';
import type { WorkspaceRecord } from '@/shared/messages';

// Alt+1-9 switches workspace directly (only when no modifier conflicts and no input is focused).
// Alt+ArrowLeft / Alt+ArrowRight cycle through workspaces with wrap-around at both ends.
export function useWorkspaceShortcut(workspaces: WorkspaceRecord[], onSwitch: (id: string) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) return;

      // Alt+ArrowLeft = previous workspace (wrap), Alt+ArrowRight = next workspace (wrap).
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (workspaces.length === 0) return;
        e.preventDefault();
        const currentIndex = workspaces.findIndex(w => w.id === (document.querySelector('.ff-ws-tab.is-active') as HTMLElement | null)?.dataset.workspaceId);
        const safeIndex = currentIndex < 0 ? 0 : currentIndex;
        const nextIndex = e.key === 'ArrowLeft'
          ? (safeIndex - 1 + workspaces.length) % workspaces.length
          : (safeIndex + 1) % workspaces.length;
        const next = workspaces[nextIndex];
        if (next) onSwitch(next.id);
        return;
      }

      // Alt+1..9 direct jump.
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
