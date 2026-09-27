import type { FolderCountBadgeMode, FolderOpenMode } from '@/shared/messages';
import { useId } from 'react';
import { Segmented, Toggle } from '../settings-controls';
import type { SectionProps } from './types';

export function NavigationSection({ settings, onPatch }: SectionProps) {
  const showSearchBarLabelId = useId();
  const rememberLastFolderLabelId = useId();
  const folderOpenModeLabelId = useId();
  const folderCountBadgeModeLabelId = useId();
  const openLinksInNewTabLabelId = useId();
  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">Navigation</h3>
      <p className="ff-set-section__desc">How you move around the new tab page.</p>
      <div className="ff-card">
        <div className="ff-row">
          <div>
            <div className="ff-row__label" id={showSearchBarLabelId}>Show search bar</div>
            <div className="ff-row__hint">Subtle by default — expands when focused.</div>
          </div>
          <Toggle labelledBy={showSearchBarLabelId} on={settings.showSearchBar} onChange={(v) => onPatch({ showSearchBar: v })} />
        </div>
        <div className="ff-row">
          <div>
            <div className="ff-row__label" id={rememberLastFolderLabelId}>Remember last workspace</div>
            <div className="ff-row__hint">Reopen the workspace you were using when you closed the tab.</div>
          </div>
          <Toggle labelledBy={rememberLastFolderLabelId} on={settings.rememberLastFolder} onChange={(v) => onPatch({ rememberLastFolder: v })} />
        </div>
        <div className="ff-row">
          <div>
            <div className="ff-row__label" id={folderOpenModeLabelId}>Open folders as</div>
            <div className="ff-row__hint">Overlay keeps the page underneath; Page navigates in with breadcrumbs.</div>
          </div>
          <Segmented<FolderOpenMode>
            labelledBy={folderOpenModeLabelId}
            options={[{ id: 'overlay', label: 'Overlay' }, { id: 'page', label: 'Page' }]}
            value={settings.folderOpenMode}
            onChange={(v) => onPatch({ folderOpenMode: v })}
          />
        </div>
        <div className="ff-row">
          <div>
            <div className="ff-row__label" id={folderCountBadgeModeLabelId}>Folder count badge</div>
            <div className="ff-row__hint">Always shows the bookmark count; On hover reveals it only when you point at the tile.</div>
          </div>
          <Segmented<FolderCountBadgeMode>
            labelledBy={folderCountBadgeModeLabelId}
            options={[{ id: 'always', label: 'Always' }, { id: 'hover', label: 'On hover' }]}
            value={settings.folderCountBadgeMode}
            onChange={(v) => onPatch({ folderCountBadgeMode: v })}
          />
        </div>
        <div className="ff-row">
          <div>
            <div className="ff-row__label" id={openLinksInNewTabLabelId}>Open bookmarks in new tab</div>
            <div className="ff-row__hint">Hold Ctrl/Cmd to override per click.</div>
          </div>
          <Toggle labelledBy={openLinksInNewTabLabelId} on={settings.openLinksInNewTab} onChange={(v) => onPatch({ openLinksInNewTab: v })} />
        </div>
      </div>
    </div>
  );
}
