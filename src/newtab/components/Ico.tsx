import type { CSSProperties } from 'react';

const UI_ICONS: Record<string, string> = {
  search:       'M21 21l-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z',
  home:         'M3 11l9-8 9 8M5 9.5V21h14V9.5',
  settings:     'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  close:        'M18 6L6 18M6 6l12 12',
  plus:         'M12 5v14M5 12h14',
  chevronDown:  'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft:  'M15 6l-6 6 6 6',
  arrowRight:   'M5 12h14M13 5l7 7-7 7',
  sort:         'M3 6h13M3 12h9M3 18h6M17 8v12M17 20l4-4M17 20l-4-4',
  pencil:       'M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
  trash:        'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  folder:       'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  folderPlus:   'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM12 11v6M9 14h6',
  sun:          'M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  moon:         'M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z',
  monitor:      'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zM8 21h8M12 17v4',
  command:      'M18 3a3 3 0 0 0 0 6h-3V6a3 3 0 0 0-3-3M6 3a3 3 0 0 1 0 6h3V6a3 3 0 0 1 3-3M6 21a3 3 0 0 1 0-6h3v3a3 3 0 0 1-3 3M18 21a3 3 0 0 0 0-6h-3v3a3 3 0 0 0 3 3',
  upload:       'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  download:     'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  check:        'M5 12l5 5 10-10',
  star:         'M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z',
  refresh:      'M3 12a9 9 0 0 1 15.5-6.36L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.36L3 16M3 21v-5h5',
  more:         'M5 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM12 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  moreVertical: 'M12 5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM12 17a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  layers:       'M12 2l10 5-10 5L2 7l10-5zM2 12l10 5 10-5M2 17l10 5 10-5',
  palette:      'M12 22a10 10 0 1 1 10-10c0 2.5-2 4-4 4h-2a2 2 0 0 0-2 2v1a2 2 0 0 1-2 2zM7 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM12 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  link:         'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 1 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 1 0 7 7l1-1',
  zap:          'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  layoutGrid:   'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  rows:         'M3 3h18v6H3zM3 15h18v6H3z',
  cloud:        'M18 10a5 5 0 0 0-9.6-1.5A4.5 4.5 0 1 0 7 17h10a4 4 0 0 0 1-7z',
  clock:        'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  copy:         'M9 9h12v12H9zM5 15H3V5a2 2 0 0 1 2-2h10v2',
  bookmark:     'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  circleHelp:   'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01',
  folderTree:   'M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1ZM20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.9-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1ZM3 5a2 2 0 0 0 2 2h3M3 3v13a2 2 0 0 0 2 2h3',
};

export interface IcoProps {
  name: keyof typeof UI_ICONS | string;
  size?: number;
  stroke?: number;
  className?: string;
  style?: CSSProperties;
}

export function Ico({ name, size = 16, stroke = 1.5, className = '', style }: IcoProps) {
  const d = UI_ICONS[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
