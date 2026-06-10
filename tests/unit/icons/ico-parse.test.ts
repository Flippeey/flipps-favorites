import { describe, expect, it } from 'vitest';
import { extractLargestIcoPng, isIcoBytes, parseIcoDirectory } from '@/background/icons/ico-parse';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

// Build a minimal ICO container: 6-byte header + 16-byte directory entries +
// concatenated payloads. Payload content is arbitrary bytes for the test.
function buildIco(entries: Array<{ width: number; height: number; payload: number[] }>): Uint8Array {
  const headerBytes = 6;
  const dirBytes = entries.length * 16;
  const totalPayload = entries.reduce((sum, entry) => sum + entry.payload.length, 0);
  const bytes = new Uint8Array(headerBytes + dirBytes + totalPayload);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1, true); // type 1 = icon
  view.setUint16(4, entries.length, true);

  let payloadOffset = headerBytes + dirBytes;
  entries.forEach((entry, index) => {
    const dirOffset = headerBytes + index * 16;
    bytes[dirOffset] = entry.width === 256 ? 0 : entry.width;
    bytes[dirOffset + 1] = entry.height === 256 ? 0 : entry.height;
    view.setUint32(dirOffset + 8, entry.payload.length, true);
    view.setUint32(dirOffset + 12, payloadOffset, true);
    bytes.set(entry.payload, payloadOffset);
    payloadOffset += entry.payload.length;
  });
  return bytes;
}

const pngPayload = (filler: number) => [...PNG_MAGIC, 0x0d, 0x0a, 0x1a, 0x0a, filler, filler];
const bmpPayload = () => [0x28, 0x00, 0x00, 0x00, 0x01, 0x02];

describe('isIcoBytes', () => {
  it('recognises the ICO magic', () => {
    expect(isIcoBytes(buildIco([{ width: 16, height: 16, payload: bmpPayload() }]))).toBe(true);
  });

  it('rejects PNG bytes and short buffers', () => {
    expect(isIcoBytes(new Uint8Array(pngPayload(1)))).toBe(false);
    expect(isIcoBytes(new Uint8Array([0, 0]))).toBe(false);
  });
});

describe('parseIcoDirectory', () => {
  it('reads sizes, treats 0 as 256, and flags PNG payloads', () => {
    const ico = buildIco([
      { width: 16, height: 16, payload: bmpPayload() },
      { width: 256, height: 256, payload: pngPayload(7) },
    ]);
    const entries = parseIcoDirectory(ico);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ width: 16, height: 16, isPng: false });
    expect(entries[1]).toMatchObject({ width: 256, height: 256, isPng: true });
  });

  it('skips entries whose payload range exceeds the buffer', () => {
    const ico = buildIco([{ width: 32, height: 32, payload: pngPayload(3) }]);
    // Corrupt the declared payload length so it overruns the file.
    new DataView(ico.buffer).setUint32(6 + 8, 9999, true);
    expect(parseIcoDirectory(ico)).toHaveLength(0);
  });
});

describe('extractLargestIcoPng', () => {
  it('returns the largest embedded PNG, ignoring BMP entries', () => {
    // The whole point: a multi-size favicon.ico (like dev.azure.com's) should
    // yield its biggest PNG so worker contexts can decode it as a plain PNG.
    const big = pngPayload(9);
    const ico = buildIco([
      { width: 16, height: 16, payload: pngPayload(1) },
      { width: 48, height: 48, payload: bmpPayload() },
      { width: 256, height: 256, payload: big },
    ]);
    const extracted = extractLargestIcoPng(ico);
    expect(extracted).not.toBeNull();
    expect(extracted?.width).toBe(256);
    expect(Array.from(extracted?.png ?? [])).toEqual(big);
  });

  it('returns null for BMP-only icons', () => {
    const ico = buildIco([{ width: 32, height: 32, payload: bmpPayload() }]);
    expect(extractLargestIcoPng(ico)).toBeNull();
  });
});
