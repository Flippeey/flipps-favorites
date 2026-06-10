// Minimal ICO container parsing. Service-worker contexts cannot reliably decode
// .ico files via createImageBitmap, but most modern multi-size favicons embed
// PNG payloads — extract the largest one and validate it as a plain PNG instead.

interface IcoDirectoryEntry {
  width: number;
  height: number;
  byteLength: number;
  byteOffset: number;
  isPng: boolean;
}

const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

export function isIcoBytes(bytes: Uint8Array): boolean {
  return bytes.length >= ICO_HEADER_BYTES
    && bytes[0] === 0 && bytes[1] === 0
    && bytes[2] === 1 && bytes[3] === 0;
}

export function parseIcoDirectory(bytes: Uint8Array): IcoDirectoryEntry[] {
  if (!isIcoBytes(bytes)) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4, true);
  const entries: IcoDirectoryEntry[] = [];
  for (let index = 0; index < count; index++) {
    const offset = ICO_HEADER_BYTES + index * ICO_ENTRY_BYTES;
    if (offset + ICO_ENTRY_BYTES > bytes.length) break;
    // Width/height bytes use 0 to mean 256.
    const width = bytes[offset] || 256;
    const height = bytes[offset + 1] || 256;
    const byteLength = view.getUint32(offset + 8, true);
    const byteOffset = view.getUint32(offset + 12, true);
    if (byteLength === 0 || byteOffset + byteLength > bytes.length) continue;
    const isPng = PNG_MAGIC.every((value, i) => bytes[byteOffset + i] === value);
    entries.push({ width, height, byteLength, byteOffset, isPng });
  }
  return entries;
}

// Largest embedded PNG payload, or null when the ICO has none (BMP-only icons).
export function extractLargestIcoPng(bytes: Uint8Array): { png: Uint8Array; width: number; height: number } | null {
  const pngEntries = parseIcoDirectory(bytes)
    .filter(entry => entry.isPng)
    .sort((left, right) => Math.min(right.width, right.height) - Math.min(left.width, left.height));
  const best = pngEntries[0];
  if (!best) return null;
  return {
    png: bytes.slice(best.byteOffset, best.byteOffset + best.byteLength),
    width: best.width,
    height: best.height,
  };
}
