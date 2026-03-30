import type { AppSettings, LayoutPresetId, ThemeMode } from '../../shared/messages';
import { t } from '../../shared/i18n';

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
  { id: 'light', label: t('options.theme.light.label'), description: t('options.theme.light.description'), preview: 'light' },
  { id: 'dark', label: t('options.theme.dark.label'), description: t('options.theme.dark.description'), preview: 'dark' },
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
    label: t('options.layout.balanced.label'),
    description: t('options.layout.balanced.description'),
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
    label: t('options.layout.compact.label'),
    description: t('options.layout.compact.description'),
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
    label: t('options.layout.spacious.label'),
    description: t('options.layout.spacious.description'),
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
    label: t('options.layout.presentation.label'),
    description: t('options.layout.presentation.description'),
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

export function getShortcutGroups(): Array<{ label: string; items: Array<{ keys: string; description: string }> }> {
  return [
    {
      label: t('options.shortcuts.group.selection'),
      items: [
        { keys: 'Ctrl/Cmd+Click', description: t('options.shortcuts.selection.ctrl-click') },
        { keys: 'Drag on empty space', description: t('options.shortcuts.selection.marquee') },
        { keys: 'Escape', description: t('options.shortcuts.selection.escape') },
      ],
    },
    {
      label: t('options.shortcuts.group.clipboard'),
      items: [
        { keys: 'Ctrl/Cmd+C', description: t('options.shortcuts.clipboard.copy') },
        { keys: 'Ctrl/Cmd+X', description: t('options.shortcuts.clipboard.cut') },
        { keys: 'Ctrl/Cmd+V', description: t('options.shortcuts.clipboard.paste') },
      ],
    },
    {
      label: t('options.shortcuts.group.history'),
      items: [
        { keys: 'Ctrl/Cmd+Z', description: t('options.shortcuts.history.undo') },
        { keys: 'Ctrl/Cmd+Shift+Z', description: t('options.shortcuts.history.redo') },
        { keys: 'Ctrl/Cmd+Y', description: t('options.shortcuts.history.redo-alt') },
      ],
    },
    {
      label: t('options.shortcuts.group.actions'),
      items: [
        { keys: 'Delete / Backspace', description: t('options.shortcuts.actions.delete') },
        { keys: 'Ctrl/Cmd+Click', description: t('options.shortcuts.actions.open-tab') },
        { keys: 'Ctrl/Cmd+K or Ctrl/Cmd+S', description: t('options.shortcuts.actions.search') },
      ],
    },
  ];
}
