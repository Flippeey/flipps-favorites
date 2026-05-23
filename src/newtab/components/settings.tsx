import { useEffect, useState } from 'react';
import type { AppSettings, BookmarkNode, WorkspaceRecord } from '../../shared/messages';
import { Ico } from './Ico';
import {
  AppearanceSection,
  BackupSection,
  ClockSection,
  DockSection,
  HelpSection,
  LayoutSection,
  NavigationSection,
  WorkspaceManageSection,
} from './settings-sections';

// Re-export controls/presets used by sibling components (Onboarding, NewWorkspaceDialog).
export {
  ACCENT_PRESETS,
  LAYOUT_PRESETS,
  CUSTOM_LAYOUT_PRESET,
  Toggle,
  Segmented,
  FolderPicker,
  ThemeCardPreview,
} from './settings-controls';

type SectionId = 'navigation' | 'appearance' | 'layout' | 'dock' | 'clock' | 'backup' | 'help' | 'workspace-manage';

// Contextual drawer title — replaces the static "Personalize".
const SECTION_TITLES: Record<SectionId, string> = {
  appearance:        'Appearance',
  layout:            'Layout',
  'workspace-manage': 'Workspace',
  navigation:        'Navigation',
  dock:              'Dock',
  clock:             'Clock',
  backup:            'Backup',
  help:              'Help',
};
type SettingsScopeTab = 'global' | 'workspace';

interface SettingsDrawerProps {
  settings: AppSettings;
  activeWorkspace: WorkspaceRecord | null;
  workspaceWallpaper: string;
  onPatchGlobal: (patch: Partial<AppSettings>) => void;
  onPatchWorkspace: (patch: Partial<WorkspaceRecord>) => void;
  onSetWorkspaceWallpaper: (dataUrl: string) => void;
  onDeleteWorkspace: (id: string) => void;
  isOnlyWorkspace: boolean;
  initialSection?: SectionId;
  initialScopeTab?: SettingsScopeTab;
  tree: BookmarkNode[];
  onClose: () => void;
  onAfterImport: (settings: AppSettings) => void;
}

export function SettingsDrawer({ settings, activeWorkspace, workspaceWallpaper, onPatchGlobal, onPatchWorkspace, onSetWorkspaceWallpaper, onDeleteWorkspace, isOnlyWorkspace, initialSection = 'appearance', initialScopeTab = 'workspace', tree, onClose, onAfterImport }: SettingsDrawerProps) {
  const [section, setSection] = useState<SectionId>(initialSection);
  const [scopeTab, setScopeTab] = useState<SettingsScopeTab>(initialScopeTab);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="ff-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ background: 'rgba(0,0,0,0.35)' }} />
      <aside className="ff-drawer" role="dialog" aria-label="Settings">
        <header className="ff-drawer__head">
          <div>
            <div className="ff-dialog__eyebrow">Settings</div>
            <div className="ff-dialog__title">{SECTION_TITLES[section]}</div>
          </div>
          <button className="ff-iconbtn ff-iconbtn--icon" aria-label="Close" onClick={onClose}>
            <Ico name="close" size={16} />
          </button>
        </header>
        <div className="ff-drawer__body">
          <div className="ff-drawer__sidebar">
            <div className="ff-drawer__scope-tabs">
              <button
                className={`ff-drawer__scope-tab${scopeTab === 'workspace' ? ' is-active' : ''}`}
                onClick={() => { setScopeTab('workspace'); setSection('appearance'); }}
              >
                Workspace
              </button>
              <button
                className={`ff-drawer__scope-tab${scopeTab === 'global' ? ' is-active' : ''}`}
                onClick={() => { setScopeTab('global'); setSection('navigation'); }}
              >
                Global
              </button>
            </div>
            <nav className="ff-drawer__nav">
              {scopeTab === 'workspace' && (
                <>
                  <DrawerNav id="appearance"        label="Appearance" icon="palette"    active={section} setActive={setSection} />
                  <DrawerNav id="layout"            label="Layout"     icon="rows"       active={section} setActive={setSection} />
                  <DrawerNav id="workspace-manage"  label="Manage"     icon="settings"   active={section} setActive={setSection} />
                </>
              )}
              {scopeTab === 'global' && (
                <>
                  <DrawerNav id="navigation" label="Navigation" icon="command"    active={section} setActive={setSection} />
                  <DrawerNav id="dock"       label="Dock"       icon="layers"     active={section} setActive={setSection} />
                  <DrawerNav id="clock"      label="Clock"      icon="clock"      active={section} setActive={setSection} />
                </>
              )}
            </nav>
            <nav className="ff-drawer__nav ff-drawer__nav--footer">
              <DrawerNav id="backup" label="Backup" icon="cloud" active={section} setActive={setSection} />
              <DrawerNav id="help"   label="Help"   icon="link"  active={section} setActive={setSection} />
            </nav>
          </div>
          <div className="ff-drawer__content no-scrollbar">
            {section === 'backup' && <BackupSection onAfterImport={onAfterImport} />}
            {section === 'help'   && <HelpSection />}
            {scopeTab === 'workspace' && section !== 'backup' && section !== 'help' && (
              <>
                {section === 'appearance'       && <AppearanceSection workspace={activeWorkspace} workspaceWallpaper={workspaceWallpaper} onPatch={onPatchWorkspace} onSetWallpaper={onSetWorkspaceWallpaper} settings={settings} onPatchGlobal={onPatchGlobal} />}
                {section === 'layout'           && <LayoutSection workspace={activeWorkspace} onPatch={onPatchWorkspace} />}
                {section === 'workspace-manage' && <WorkspaceManageSection workspace={activeWorkspace} onPatch={onPatchWorkspace} onDeleteWorkspace={onDeleteWorkspace} isOnlyWorkspace={isOnlyWorkspace} />}
              </>
            )}
            {scopeTab === 'global' && section !== 'backup' && section !== 'help' && (
              <>
                {section === 'navigation' && <NavigationSection settings={settings} onPatch={onPatchGlobal} />}
                {section === 'dock'       && <DockSection settings={settings} tree={tree} onPatch={onPatchGlobal} />}
                {section === 'clock'      && <ClockSection settings={settings} onPatch={onPatchGlobal} />}
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function DrawerNav({ id, label, icon, active, setActive }: {
  id: SectionId; label: string; icon: string; active: SectionId; setActive: (id: SectionId) => void;
}) {
  return (
    <button className="ff-drawer__navitem" data-active={active === id} onClick={() => setActive(id)}>
      <Ico name={icon} size={16} />
      <span>{label}</span>
    </button>
  );
}
