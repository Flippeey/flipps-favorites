import type { AppSettings, LayoutPresetId, ThemeMode } from '../../shared/messages';

export const defaultAccentColor = '#3F72DC';

export const accentPresets = [
  { id: 'blue', label: 'Blue', value: '#3F72DC' },
  { id: 'teal', label: 'Teal', value: '#23867B' },
  { id: 'green', label: 'Green', value: '#2F8F4E' },
  { id: 'lime', label: 'Lime', value: '#7BAE2C' },
  { id: 'yellow', label: 'Yellow', value: '#C9A227' },
  { id: 'orange', label: 'Orange', value: '#F57C00' },
  { id: 'red', label: 'Red', value: '#C75252' },
  { id: 'rose', label: 'Rose', value: '#C96A7D' },
  { id: 'pink', label: 'Pink', value: '#C85FA4' },
  { id: 'purple', label: 'Purple', value: '#7D60D8' },
  { id: 'slate', label: 'Slate', value: '#778292' },
  { id: 'graphite', label: 'Graphite', value: '#4B5360' },
] as const;

export const themeModeOptions: Array<{ id: Exclude<ThemeMode, 'system'>; label: string; description: string; preview: 'light' | 'dark' }> = [
  { id: 'light', label: 'Light', description: 'Bright workspace', preview: 'light' },
  { id: 'dark', label: 'Dark', description: 'Low-glare workspace', preview: 'dark' },
];

export type GeneralSettingsSubpage = 'general' | 'layout' | 'dock';

export const layoutPresetOptions: Array<{
  id: Exclude<LayoutPresetId, 'custom'>;
  label: string;
  description: string;
  settings: Pick<AppSettings, 'favoritesColumns' | 'favoritesRows' | 'favoritesColumnGap' | 'favoritesRowGap' | 'bookmarkTileWidth' | 'bookmarkIconSize'>;
}> = [
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'A comfortable all-purpose grid.',
    settings: {
      favoritesColumns: 10,
      favoritesRows: 0,
      favoritesColumnGap: 24,
      favoritesRowGap: 20,
      bookmarkTileWidth: 130,
      bookmarkIconSize: 75,
    },
  },
  {
    id: 'compact',
    label: 'Compact',
    description: 'Fit more bookmarks on screen at once.',
    settings: {
      favoritesColumns: 12,
      favoritesRows: 0,
      favoritesColumnGap: 16,
      favoritesRowGap: 14,
      bookmarkTileWidth: 108,
      bookmarkIconSize: 60,
    },
  },
  {
    id: 'spacious',
    label: 'Spacious',
    description: 'Larger tiles with more breathing room.',
    settings: {
      favoritesColumns: 8,
      favoritesRows: 0,
      favoritesColumnGap: 28,
      favoritesRowGap: 24,
      bookmarkTileWidth: 146,
      bookmarkIconSize: 82,
    },
  },
  {
    id: 'presentation',
    label: 'Presentation',
    description: 'Big visuals for wall displays and touch use.',
    settings: {
      favoritesColumns: 6,
      favoritesRows: 0,
      favoritesColumnGap: 32,
      favoritesRowGap: 28,
      bookmarkTileWidth: 168,
      bookmarkIconSize: 96,
    },
  },
];

export const shortcutGroups = [
  {
    label: 'Selection',
    items: [
      { keys: 'Ctrl/Cmd+Click', description: 'Add or remove a single item from the selection.' },
      { keys: 'Drag on empty space', description: 'Create a marquee selection in the current surface.' },
      { keys: 'Escape', description: 'Clear the selection or dismiss the current overlay.' },
    ],
  },
  {
    label: 'Clipboard',
    items: [
      { keys: 'Ctrl/Cmd+C', description: 'Copy the current selection.' },
      { keys: 'Ctrl/Cmd+X', description: 'Cut the current selection.' },
      { keys: 'Ctrl/Cmd+V', description: 'Paste into the current folder.' },
    ],
  },
  {
    label: 'History',
    items: [
      { keys: 'Ctrl/Cmd+Z', description: 'Undo the last delete or move.' },
      { keys: 'Ctrl/Cmd+Shift+Z', description: 'Redo the last undone action.' },
      { keys: 'Ctrl/Cmd+Y', description: 'Redo on keyboards that use the alternate shortcut.' },
    ],
  },
  {
    label: 'Actions',
    items: [
      { keys: 'Delete / Backspace', description: 'Delete the current selection.' },
      { keys: 'Ctrl/Cmd+Click', description: 'Open a bookmark or folder in a new tab.' },
      { keys: 'Ctrl/Cmd+K or Ctrl/Cmd+S', description: 'Focus and select the bookmark search field.' },
    ],
  },
] as const;
