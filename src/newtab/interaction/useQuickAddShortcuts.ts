import { useEffect } from 'react';
import type { BookmarkNode } from '@/shared/messages';
import type { MarqueeSelection } from './useMarquee';
import { findNode, isFolder } from '../lib/tree';

interface UseQuickAddShortcutsArgs {
  enabled: boolean;
  selection: MarqueeSelection;
  tree: BookmarkNode[];
  onNewBookmark: () => void;
  onNewFolder: () => void;
  onNewWorkspace: () => void;
  onRenameFolder: (folder: BookmarkNode) => void;
  onEditBookmark: (item: BookmarkNode) => void;
  onOpenHelp: () => void;
}

// Single-key quick-add shortcuts (a/f/w add bookmark/folder/workspace; e edits
// the lone selected tile; ? opens help & shortcuts). Inert while any overlay/dialog
// is open or focus is in a text field. Pure relocation of App.tsx's keydown effect —
// behavior unchanged (plus the newly-wired `?` shortcut).
export function useQuickAddShortcuts(args: UseQuickAddShortcutsArgs): void {
  const { enabled, selection, tree, onNewBookmark, onNewFolder, onNewWorkspace, onRenameFolder, onEditBookmark, onOpenHelp } = args;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || !enabled) return;

      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;

      const mod = e.ctrlKey || e.metaKey;

      if (e.key === '?' && !mod && !e.altKey) {
        e.preventDefault();
        onOpenHelp();
        return;
      }

      if (mod || e.altKey || e.shiftKey) return;

      switch (e.key.toLowerCase()) {
        case 'a':
          e.preventDefault();
          onNewBookmark();
          break;
        case 'f':
          e.preventDefault();
          onNewFolder();
          break;
        case 'w':
          e.preventDefault();
          onNewWorkspace();
          break;
        case 'e': {
          if (selection.ids.size === 1) {
            const id = [...selection.ids][0];
            const node = findNode(tree, id);
            if (node) {
              if (isFolder(node)) onRenameFolder(node);
              else onEditBookmark(node);
            }
          }
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, selection, tree, onNewBookmark, onNewFolder, onNewWorkspace, onRenameFolder, onEditBookmark, onOpenHelp]);
}
