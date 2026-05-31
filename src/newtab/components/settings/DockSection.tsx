import type { BookmarkNode } from '@/shared/messages';
import { FolderMultiPicker } from '../FolderMultiPicker';
import { Segmented } from '../settings-controls';
import { resolveDockMode, type DockMode } from '@/newtab/lib/dock-mode';
import type { SectionProps } from './types';

export function DockSection({ settings, tree, onPatch }: SectionProps & { tree: BookmarkNode[] }) {
  const visibility: DockMode = resolveDockMode(settings.showDock, settings.autoHideDock);
  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">Dock</h3>
      <p className="ff-set-section__desc">A pinned row at the bottom for your most-used links.</p>
      <div className="ff-card">
        <div className="ff-row">
          <div className="ff-row__label">Visibility</div>
          <Segmented<'always' | 'hover' | 'hidden'>
            options={[
              { id: 'always', label: 'Always' },
              { id: 'hover',  label: 'On hover' },
              { id: 'hidden', label: 'Hidden' },
            ]}
            value={visibility}
            onChange={(v) => {
              if (v === 'hidden') onPatch({ showDock: false });
              else if (v === 'hover') onPatch({ showDock: true, autoHideDock: true });
              else onPatch({ showDock: true, autoHideDock: false });
            }}
          />
        </div>
        <div style={{ padding: 'var(--s-3) 0' }}>
          <div className="ff-row__label" style={{ marginBottom: 4 }}>Source folder</div>
          <div className="ff-row__hint" style={{ marginBottom: 8 }}>Show items from this folder.</div>
          <FolderMultiPicker
            tree={tree}
            selectedIds={settings.dockFolderId ? [settings.dockFolderId] : []}
            onToggle={(id) => onPatch({ dockFolderId: id })}
          />
        </div>
      </div>
    </div>
  );
}
