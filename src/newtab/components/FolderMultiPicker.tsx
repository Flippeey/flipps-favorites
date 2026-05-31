import type { BookmarkNode } from '@/shared/messages';
import { topLevelFolders } from '../lib/tree';
import { Ico } from './Ico';

export interface FolderMultiPickerProps {
  tree: BookmarkNode[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  excludeIds?: Set<string>;
}

export function twoLevelFolders(tree: BookmarkNode[]): { id: string; title: string; depth: number }[] {
  const result: { id: string; title: string; depth: number }[] = [];
  for (const f of topLevelFolders(tree)) {
    result.push({ id: f.id, title: f.title, depth: 0 });
    if (f.children) {
      for (const child of f.children) {
        if (Array.isArray(child.children)) {
          result.push({ id: child.id, title: child.title, depth: 1 });
        }
      }
    }
  }
  return result;
}

export function FolderMultiPicker({ tree, selectedIds, onToggle, excludeIds }: FolderMultiPickerProps) {
  const folders = twoLevelFolders(tree).filter(f => !excludeIds?.has(f.id));
  return (
    <div style={{ display: 'grid', gap: 4, maxHeight: 240, overflowY: 'auto', paddingRight: 2 }}>
      {folders.map(f => {
        const active = selectedIds.includes(f.id);
        return (
          <button
            key={f.id}
            onClick={() => onToggle(f.id)}
            className="ff-card"
            style={{
              textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'var(--fg-1)',
              borderColor: active ? 'var(--accent)' : 'var(--line-1)',
              background: active ? 'color-mix(in oklab, var(--accent) 7%, var(--ink-2))' : 'var(--ink-2)',
              boxShadow: active ? '0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent)' : 'none',
              padding: '7px 12px',
              paddingLeft: 12 + f.depth * 18,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <Ico name="folder" size={f.depth === 0 ? 14 : 12} style={{ opacity: f.depth === 0 ? 1 : 0.7 }} />
            <span style={{ fontSize: f.depth === 0 ? 13 : 12, opacity: f.depth === 0 ? 1 : 0.85 }}>{f.title}</span>
            {active && <Ico name="check" size={13} style={{ marginLeft: 'auto', color: 'var(--accent)' }} />}
          </button>
        );
      })}
    </div>
  );
}
