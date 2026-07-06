import { useState } from 'react';
import type { BookmarkNode } from '@/shared/messages';
import { flattenFolderTree, initialExpansionForSelection } from '../lib/tree';
import { Ico } from './Ico';

export interface FolderPickerProps {
  tree: BookmarkNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  // When true, the picker does not scroll itself — an ancestor owns the scroll.
  // Avoids stacking a second scrollbar inside an already-scrollable container.
  embedded?: boolean;
  // When true (default), the tree opens to the path of the selected folder on
  // mount. Set false for compact contexts that want a collapsed tree.
  autoExpand?: boolean;
}

export function FolderPicker({ tree, selectedId, onSelect, embedded, autoExpand = true }: FolderPickerProps) {
  // Seed expansion with the path to the selected folder so a deep selection is
  // visible without the user having to drill back down to it.
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    autoExpand ? initialExpansionForSelection(tree, selectedId) : new Set<string>(),
  );

  const toggleExpand = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows = flattenFolderTree(tree, expanded);

  return (
    <div style={{ display: 'grid', gap: 4, ...(embedded ? {} : { maxHeight: 240, overflowY: 'auto' }), paddingRight: 2 }}>
      {rows.map(f => {
        const active = f.id === selectedId;
        const isOpen = expanded.has(f.id);
        return (
          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: f.depth * 16 }}>
            {f.hasChildren ? (
              <button
                type="button"
                onClick={() => toggleExpand(f.id)}
                className="ff-iconbtn ff-iconbtn--icon"
                aria-label={isOpen ? `Collapse ${f.title}` : `Expand ${f.title}`}
                aria-expanded={isOpen}
                style={{ flexShrink: 0, width: 22, height: 22, display: 'grid', placeItems: 'center' }}
              >
                <Ico
                  name="chevronRight"
                  size={13}
                  style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}
                />
              </button>
            ) : (
              <span style={{ width: 22, flexShrink: 0 }} />
            )}
            <button
              type="button"
              onClick={() => onSelect(f.id)}
              className="ff-card"
              data-folder-id={f.id}
              data-folder-title={f.title}
              style={{
                flex: 1, minWidth: 0,
                textAlign: 'left', cursor: 'pointer', font: 'inherit',
                color: 'var(--fg-1)',
                borderColor: active ? 'var(--accent)' : 'var(--line-1)',
                background: active ? 'color-mix(in oklab, var(--accent) 7%, var(--ink-2))' : 'var(--ink-2)',
                boxShadow: active ? '0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent)' : 'none',
                padding: '7px 12px',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <Ico
                name="folder"
                size={f.depth === 0 ? 14 : 12}
                style={{ opacity: f.depth === 0 ? 1 : 0.75, flexShrink: 0 }}
              />
              <span style={{
                fontSize: f.depth === 0 ? 13 : 12,
                opacity: f.depth === 0 ? 1 : 0.9,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{f.title}</span>
              {active && <Ico name="check" size={13} style={{ marginLeft: 'auto', color: 'var(--accent)', flexShrink: 0 }} />}
            </button>
          </div>
        );
      })}
    </div>
  );
}
