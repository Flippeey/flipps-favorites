import { deflateSync } from 'node:zlib';
import type { WorkspaceRecord } from '../../src/shared/models';

/**
 * Create a solid-color PNG of the given dimensions.
 * Used to mock favicon/icon HTTP responses — must be ≥48×48 so the icon
 * service's assertImageIsUseful() check passes.
 */
function createSolidPng(width: number, height: number, r: number, g: number, b: number): Buffer {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  function crc32(buf: Buffer): number {
    let crc = 0xFFFFFFFF;
    for (const byte of buf) crc = (crcTable[(crc ^ byte) & 0xFF] ?? 0) ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(type: string, data: Buffer): Buffer {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32BE(data.length, 0);
    const combined = Buffer.concat([t, data]);
    const crcBuf = Buffer.allocUnsafe(4);
    crcBuf.writeUInt32BE(crc32(combined), 0);
    return Buffer.concat([len, combined, crcBuf]);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.from([0, 0, 0, width, 0, 0, 0, height, 8, 2, 0, 0, 0]);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  const row = Buffer.allocUnsafe(1 + width * 3);
  row[0] = 0;
  for (let i = 1; i < row.length; i += 3) { row[i] = r; row[i + 1] = g; row[i + 2] = b; }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * A 64×64 solid green PNG used to mock favicon responses.
 * Large enough to pass the icon service's 48px minimum size check.
 */
export const MOCK_FAVICON_PNG = createSolidPng(64, 64, 0, 128, 0);

/** Storage key constants mirroring src/shared/storage.ts */
export const STORAGE_KEYS = {
  appSettings: 'app-settings',
  workspaces: 'workspaces',
  onboardingState: 'onboarding-state',
  iconCacheRecords: 'icon-cache-records',
  iconOverrideRecords: 'icon-override-records',
  appWallpaper: 'app-wallpaper',
} as const;

/**
 * Default workspace visual/layout settings, mirroring
 * `defaultWorkspaceSettings` in src/shared/storage.ts. Kept typed against the
 * shared WorkspaceRecord so a model change surfaces here at compile time.
 */
export const DEFAULT_WORKSPACE_SETTINGS: Omit<WorkspaceRecord, 'id' | 'name' | 'rootFolderId'> = {
  themeMode: 'system',
  accentColor: '#3F72DC',
  backgroundMode: 'gradient',
  solidBackgroundColor: '',
  gradientStyle: 'top',
  gradientColorSource: 'accent',
  gradientCustomColor: '#3F72DC',
  gradientIntensity: 100,
  backgroundOpacity: 70,
  backgroundFitMode: 'cover',
  backgroundPositionMode: 'center',
  layoutPreset: 'balanced',
  favoritesColumnGap: 24,
  favoritesRowGap: 20,
  bookmarkTileWidth: 130,
  bookmarkIconSize: 75,
  tileShape: 'squircle',
  showTileLabels: true,
};

/** Preset accent colors from src/settings/config/options.ts */
export const ACCENT_PRESETS = {
  blue: '#3F72DC',
  teal: '#23867B',
  red: '#C75252',
  green: '#2F8F4E',
} as const;
