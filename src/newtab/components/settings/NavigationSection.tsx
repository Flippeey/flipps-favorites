import type { FolderOpenMode, ViewMode } from '../../../shared/messages';
import { Segmented, Toggle } from '../settings-controls';
import type { SectionProps } from './types';

export function NavigationSection({ settings, onPatch }: SectionProps) {
  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">Navigation</h3>
      <p className="ff-set-section__desc">How you move around the new tab page.</p>
      <div className="ff-card">
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Show search bar</div>
            <div className="ff-row__hint">Subtle by default — expands when focused.</div>
          </div>
          <Toggle on={settings.showSearchBar} onChange={(v) => onPatch({ showSearchBar: v })} />
        </div>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Remember last workspace</div>
            <div className="ff-row__hint">Reopen the workspace you were using when you closed the tab.</div>
          </div>
          <Toggle on={settings.rememberLastFolder} onChange={(v) => onPatch({ rememberLastFolder: v })} />
        </div>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">View</div>
            <div className="ff-row__hint">Grid shows folders as compact tiles; List unfolds every folder inline.</div>
          </div>
          <Segmented<ViewMode>
            options={[{ id: 'grid', label: 'Grid' }, { id: 'list', label: 'List' }]}
            value={settings.folderMode}
            onChange={(v) => onPatch({ folderMode: v })}
          />
        </div>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Open folders as</div>
            <div className="ff-row__hint">Overlay keeps the page underneath; Page navigates in with breadcrumbs.</div>
          </div>
          <Segmented<FolderOpenMode>
            options={[{ id: 'overlay', label: 'Overlay' }, { id: 'page', label: 'Page' }]}
            value={settings.folderOpenMode}
            onChange={(v) => onPatch({ folderOpenMode: v })}
          />
        </div>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Open bookmarks in new tab</div>
            <div className="ff-row__hint">Hold Ctrl/Cmd to override per click.</div>
          </div>
          <Toggle on={settings.openLinksInNewTab} onChange={(v) => onPatch({ openLinksInNewTab: v })} />
        </div>
      </div>
    </div>
  );
}
