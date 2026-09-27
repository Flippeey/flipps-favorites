// Origin HTML can be arbitrarily large; cap what we scan so a pathological
// or adversarial page can't turn icon resolution into an unbounded parse.
export const ORIGIN_HTML_PARSE_LIMIT = 256 * 1024;

export function parseOriginIconCandidates(html: string, origin: string): Array<{ url: string; sizeHint: number; weight: number }> {
  const candidates: Array<{ url: string; sizeHint: number; weight: number }> = [];
  const limited = html.slice(0, ORIGIN_HTML_PARSE_LIMIT);
  const linkRegex = /<link\b[^<>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(limited)) !== null) {
    const tag = match[0];
    const rel = extractAttr(tag, 'rel')?.toLowerCase() ?? '';
    if (!/(icon|apple-touch-icon|shortcut icon|mask-icon|fluid-icon)/.test(rel)) continue;
    const href = extractAttr(tag, 'href');
    if (!href) continue;
    let absolute: string;
    try {
      absolute = new URL(href, `${origin}/`).toString();
    } catch {
      continue;
    }
    const sizesAttr = extractAttr(tag, 'sizes') ?? '';
    const sizeHint = parseLargestSize(sizesAttr);
    let weight = 50;
    if (rel.includes('apple-touch-icon')) weight = 100;
    else if (rel.includes('mask-icon')) weight = 30;
    else if (rel.includes('shortcut icon')) weight = 60;
    candidates.push({ url: absolute, sizeHint, weight });
  }
  return candidates;
}

export function parseManifestHref(html: string): string | null {
  const limited = html.slice(0, ORIGIN_HTML_PARSE_LIMIT);
  const linkRegex = /<link\b[^<>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(limited)) !== null) {
    const tag = match[0];
    const rel = extractAttr(tag, 'rel')?.toLowerCase() ?? '';
    if (!rel.split(/\s+/).includes('manifest')) continue;
    return extractAttr(tag, 'href');
  }
  return null;
}

function extractAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(re);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

export function parseLargestSize(sizes: string): number {
  if (!sizes) return 0;
  let best = 0;
  for (const part of sizes.toLowerCase().split(/\s+/)) {
    if (part === 'any') {
      best = Math.max(best, 512);
      continue;
    }
    const m = part.match(/^(\d+)x(\d+)$/);
    if (m) {
      const edge = Math.min(Number(m[1]), Number(m[2]));
      if (Number.isFinite(edge)) {
        best = Math.max(best, edge);
      }
    }
  }
  return best;
}

export function extractDuckDuckGoToken(html: string): string | null {
  const match =
    html.match(/vqd=['"]([^'"]+)['"]/) ??
    html.match(/"vqd"\s*:\s*"([^"]+)"/) ??
    html.match(/data-vqd=["']([^"']+)["']/) ??
    html.match(/vqd\s*=\s*['"]([^'"]+)['"]/) ??
    html.match(/vqd=([A-Za-z0-9%._-]+)/);
  return match?.[1] ?? null;
}

export function isDataUrl(value: string): boolean {
  return value.startsWith('data:image/');
}

export function normalizeDataUrl(value: string, mimeType: string): string {
  if (value.startsWith(`data:${mimeType}`) || value.startsWith('data:image/')) {
    return value;
  }
  throw new Error('Icon override must be provided as a data URL.');
}

export function getFileNameFromUrl(imageUrl: string): string {
  try {
    const pathname = new URL(imageUrl).pathname;
    const name = pathname.split('/').pop();
    return name || 'icon';
  } catch {
    return 'icon';
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
