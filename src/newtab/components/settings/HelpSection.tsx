import { MOD_KEY } from '@/newtab/lib/platform';
import { Ico } from '../Ico';

interface HelpSectionProps {
  onReplaySetup: () => void;
}

export function HelpSection({ onReplaySetup }: HelpSectionProps) {
  const mod = MOD_KEY;
  const shortcuts: ReadonlyArray<readonly [string, string]> = [
    [`${mod}+K  or  S  or  /`,    'Focus search'],
    ['A',                          'Add bookmark'],
    ['F',                          'Add folder'],
    ['W',                          'New workspace'],
    ['E',                          'Edit selected item'],
    ['?',                          'Open help & shortcuts'],
    ['Escape',                     'Close dialog, clear selection, blur search'],
    ['Alt+1-9',                    'Switch to workspace 1-9'],
    ['Arrow keys',                 'Navigate between bookmarks'],
    ['Enter',                      'Open focused bookmark or folder'],
    [`${mod}+Click`,               'Toggle item in selection'],
    ['Shift+Click',                'Select range from last clicked'],
    ['Delete',                     'Delete focused bookmark'],
  ];

  const tips: ReadonlyArray<readonly [string, string]> = [
    ['Drag & drop',        'Drag bookmarks into folders, onto the dock, or onto workspace tabs to move them — works in any sort mode. Reordering tiles in place needs "Manual" sort mode.'],
    ['Marquee select',     'Click and drag on empty space to rubber-band select multiple bookmarks at once.'],
    ['Right-click anywhere','Context menu adapts to what you click — bookmark, folder, or empty space. Quick way to add, edit, or delete.'],
    ['Custom icons',       'Edit any bookmark to swap its icon. Search for alternatives, upload your own, or paste an image URL.'],
    ['Workspaces',         'Each workspace can have its own accent color, background, and layout. Use the + button or Settings to create more.'],
    ['Dock',               'Pin your most-used links to a bottom bar. Configure visibility and source folder in Settings → Dock.'],
  ];

  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">Shortcuts</h3>
      <p className="ff-set-section__desc">Work smarter, not harder.</p>
      <div className="ff-card" style={{ marginBottom: 16 }}>
        {shortcuts.map(([kbd, label]) => (
          <div className="ff-row" key={kbd}>
            <div className="ff-row__label">{label}</div>
            <span className="ff-kbd" style={{ fontSize: 12 }}>{kbd}</span>
          </div>
        ))}
      </div>

      <h3 className="ff-set-section__title">Tips</h3>
      <p className="ff-set-section__desc">To help you get started or discover new features.</p>
      <div className="ff-card" style={{ marginBottom: 16 }}>
        {tips.map(([label, body]) => (
          <div className="ff-row" key={label} style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div className="ff-row__label">{label}</div>
              <div className="ff-row__hint">{body}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="ff-card" style={{ marginBottom: 16 }}>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Replay setup</div>
            <div className="ff-row__hint">Re-run the onboarding flow to re-pick your bookmark roots and organization template.</div>
          </div>
          <button type="button" className="ff-btn ff-btn--ghost" onClick={onReplaySetup}>
            <Ico name="zap" size={14} /> Replay
          </button>
        </div>
      </div>

      <h3 className="ff-set-section__title">About</h3>
      <div className="ff-card">
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Flipp&rsquo;s Favorites</div>
            <div className="ff-row__hint"><a href="https://www.flippflix.com/" target="_blank" rel="noopener noreferrer">
              https://www.flippflix.com/
            </a></div>
          </div>
        </div>
      </div>
    </div>
  );
}
