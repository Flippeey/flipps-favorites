import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookmarkNode } from '../../shared/messages';
import type { MarqueeSelection } from '../interaction/useMarquee';
import { isFolder } from '../lib/tree';

interface UseSelectionArgs {
  navItems: BookmarkNode[];
  rootFolder: BookmarkNode | null;
  dragEngagedRef: React.RefObject<boolean>;
  handlePickFolder: (folder: BookmarkNode) => void;
  handlePickBookmark: (item: BookmarkNode, event?: React.MouseEvent) => void;
}

interface UseSelectionResult {
  selection: MarqueeSelection;
  setSelection: React.Dispatch<React.SetStateAction<MarqueeSelection>>;
  selectionRef: React.RefObject<MarqueeSelection>;
  lastClickedRef: React.RefObject<string | null>;
  handleTileClick: (item: BookmarkNode, event: React.MouseEvent) => void;
}

export function useSelection(args: UseSelectionArgs): UseSelectionResult {
  const { navItems, rootFolder, dragEngagedRef, handlePickFolder, handlePickBookmark } = args;

  const [selection, setSelection] = useState<MarqueeSelection>({ ids: new Set(), scopeFolderId: '' });
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const lastClickedRef = useRef<string | null>(null);

  // ESC clears selection (no overlay check — individual dialogs handle their own ESC)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectionRef.current.ids.size > 0) {
        setSelection({ ids: new Set(), scopeFolderId: '' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleTileClick = useCallback((item: BookmarkNode, event: React.MouseEvent) => {
    if (dragEngagedRef.current) {
      dragEngagedRef.current = false;
      return;
    }
    const scope = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>('[data-scope-folder-id]')?.dataset.scopeFolderId ?? rootFolder?.id ?? '';

    if (event.metaKey || event.ctrlKey) {
      setSelection(prev => {
        const sameScope = prev.scopeFolderId === scope;
        const ids = sameScope ? new Set(prev.ids) : new Set<string>();
        if (ids.has(item.id)) ids.delete(item.id);
        else ids.add(item.id);
        return { ids, scopeFolderId: scope };
      });
      lastClickedRef.current = item.id;
      return;
    }

    if (event.shiftKey) {
      const anchor = lastClickedRef.current;
      if (anchor && navItems.length > 0) {
        const anchorIdx = navItems.findIndex(n => n.id === anchor);
        const clickIdx = navItems.findIndex(n => n.id === item.id);
        if (anchorIdx >= 0 && clickIdx >= 0) {
          const from = Math.min(anchorIdx, clickIdx);
          const to = Math.max(anchorIdx, clickIdx);
          setSelection(prev => {
            const ids = prev.scopeFolderId === scope ? new Set(prev.ids) : new Set<string>();
            for (let i = from; i <= to; i++) ids.add(navItems[i].id);
            return { ids, scopeFolderId: scope };
          });
          return;
        }
      }
      // Fallback: no anchor — treat like Ctrl+Click
      setSelection(prev => {
        const ids = prev.scopeFolderId === scope ? new Set(prev.ids) : new Set<string>();
        ids.add(item.id);
        return { ids, scopeFolderId: scope };
      });
      lastClickedRef.current = item.id;
      return;
    }

    // Plain click — clear selection. Folder/bookmark open behavior handled by caller.
    if (selectionRef.current.ids.size > 0) {
      setSelection({ ids: new Set(), scopeFolderId: '' });
    }
    lastClickedRef.current = item.id;
    if (isFolder(item)) handlePickFolder(item);
    else handlePickBookmark(item, event);
  }, [handlePickBookmark, handlePickFolder, rootFolder, navItems, dragEngagedRef]);

  return { selection, setSelection, selectionRef, lastClickedRef, handleTileClick };
}
