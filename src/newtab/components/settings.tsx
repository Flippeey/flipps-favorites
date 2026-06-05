import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, BookmarkNode, WorkspaceRecord } from '@/shared/messages';
import { useFocusTrap } from '../interaction/useFocusTrap';
import { Ico } from './Ico';
import {
  AppearanceSection,
  BackupSection,
  ClockSection,
  DockSection,
  HelpSection,
  LayoutSection,
  NavigationSection,
} from './settings/index';

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

export type AppSectionId = 'navigation' | 'dock' | 'clock' | 'backup' | 'help';
export type WorkspaceSectionId = 'appearance' | 'layout';

const APP_SECTION_TITLES: Record<AppSectionId, string> = {
  navigation: 'Navigation',
  dock:       'Dock',
  clock:      'Clock',
  backup:     'Backup',
  help:       'Help',
};

const WORKSPACE_SECTION_TITLES: Record<WorkspaceSectionId, string> = {
  appearance: 'Appearance',
  layout:     'Layout',
};

interface AppSettingsDrawerProps {
  settings: AppSettings;
  tree: BookmarkNode[];
  initialSection?: AppSectionId;
  onPatchGlobal: (patch: Partial<AppSettings>) => void;
  onAfterImport: (settings: AppSettings) => void;
  onClose: () => void;
}

export function AppSettingsDrawer({ settings, tree, initialSection = 'navigation', onPatchGlobal, onAfterImport, onClose }: AppSettingsDrawerProps) {
  const [section, setSection] = useState<AppSectionId>(initialSection);
  const [closing, setClosing] = useState(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  useFocusTrap(drawerRef);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => onClose(), 200);
  }, [closing, onClose]);

  useEffect(() => { setSection(initialSection); }, [initialSection]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose]);

  return (
    <>
      <div className="ff-modal-scrim" data-closing={closing || undefined} onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }} style={{ background: 'rgba(0,0,0,0.35)' }} />
      <aside ref={(el) => { drawerRef.current = el; }} className="ff-drawer" data-closing={closing || undefined} role="dialog" aria-modal="true" aria-label="App settings">
        <header className="ff-drawer__head">
          <div>
            <div className="ff-dialog__eyebrow">Settings</div>
            <div className="ff-dialog__title">{APP_SECTION_TITLES[section]}</div>
          </div>
          <button className="ff-iconbtn ff-iconbtn--icon" aria-label="Close" title="Close" onClick={handleClose}>
            <Ico name="close" size={16} />
          </button>
        </header>
        <div className="ff-drawer__body">
          <div className="ff-drawer__sidebar">
            <nav className="ff-drawer__nav">
              <DrawerNav id="navigation" label="Navigation" icon="command" active={section} setActive={setSection} />
              <DrawerNav id="dock"       label="Dock"       icon="layers"  active={section} setActive={setSection} />
              <DrawerNav id="clock"      label="Clock"      icon="clock"   active={section} setActive={setSection} />
            </nav>
            <nav className="ff-drawer__nav ff-drawer__nav--footer">
              <DrawerNav id="backup" label="Backup" icon="cloud" active={section} setActive={setSection} />
              <DrawerNav id="help"   label="Help"   icon="circleHelp"  active={section} setActive={setSection} />
            </nav>
          </div>
          <div className="ff-drawer__content no-scrollbar">
            {section === 'navigation' && <NavigationSection settings={settings} onPatch={onPatchGlobal} />}
            {section === 'dock'       && <DockSection settings={settings} tree={tree} onPatch={onPatchGlobal} />}
            {section === 'clock'      && <ClockSection settings={settings} onPatch={onPatchGlobal} />}
            {section === 'backup'     && <BackupSection onAfterImport={onAfterImport} />}
            {section === 'help'       && <HelpSection />}
          </div>
        </div>
      </aside>
    </>
  );
}

interface WorkspaceSettingsDrawerProps {
  settings: AppSettings;
  activeWorkspace: WorkspaceRecord | null;
  workspaceWallpaper: string;
  initialSection?: WorkspaceSectionId;
  onPatchGlobal: (patch: Partial<AppSettings>) => void;
  onPatchWorkspace: (patch: Partial<WorkspaceRecord>) => void;
  onSetWorkspaceWallpaper: (dataUrl: string) => void;
  onClose: () => void;
}

export function WorkspaceSettingsDrawer({ settings, activeWorkspace, workspaceWallpaper, initialSection = 'appearance', onPatchWorkspace, onSetWorkspaceWallpaper, onClose }: WorkspaceSettingsDrawerProps) {
  const [section, setSection] = useState<WorkspaceSectionId>(initialSection);
  const [closing, setClosing] = useState(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  useFocusTrap(drawerRef);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => onClose(), 200);
  }, [closing, onClose]);

  useEffect(() => { setSection(initialSection); }, [initialSection]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose]);

  return (
    <>
      <div className="ff-modal-scrim" data-closing={closing || undefined} onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }} style={{ background: 'rgba(0,0,0,0.35)' }} />
      <aside ref={(el) => { drawerRef.current = el; }} className="ff-drawer" data-closing={closing || undefined} role="dialog" aria-modal="true" aria-label="Workspace settings">
        <header className="ff-drawer__head">
          <div>
            <div className="ff-dialog__eyebrow">Workspace{activeWorkspace ? ` · ${activeWorkspace.name}` : ''}</div>
            <div className="ff-dialog__title">{WORKSPACE_SECTION_TITLES[section]}</div>
          </div>
          <button className="ff-iconbtn ff-iconbtn--icon" aria-label="Close" title="Close" onClick={handleClose}>
            <Ico name="close" size={16} />
          </button>
        </header>
        <div className="ff-drawer__body">
          <div className="ff-drawer__sidebar">
            <nav className="ff-drawer__nav">
              <DrawerNav id="appearance" label="Appearance" icon="palette" active={section} setActive={setSection} />
              <DrawerNav id="layout"     label="Layout"     icon="rows"    active={section} setActive={setSection} />
            </nav>
          </div>
          <div className="ff-drawer__content no-scrollbar">
            {section === 'appearance' && <AppearanceSection workspace={activeWorkspace} workspaceWallpaper={workspaceWallpaper} onPatch={onPatchWorkspace} onSetWallpaper={onSetWorkspaceWallpaper} settings={settings} />}
            {section === 'layout'     && <LayoutSection workspace={activeWorkspace} onPatch={onPatchWorkspace} />}
          </div>
        </div>
      </aside>
    </>
  );
}

function DrawerNav<T extends string>({ id, label, icon, active, setActive }: {
  id: T; label: string; icon: string; active: T; setActive: (id: T) => void;
}) {
  return (
    <button className="ff-drawer__navitem" data-active={active === id} onClick={() => setActive(id)}>
      <Ico name={icon} size={16} />
      <span>{label}</span>
    </button>
  );
}
