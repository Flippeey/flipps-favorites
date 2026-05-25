import { useEffect, useRef, useState } from 'react';
import type { TileShape } from '../../shared/messages';
import { getIcon } from '../lib/messaging';

const iconCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
const subscribers = new Map<string, Set<() => void>>();

export function invalidateFaviconCache(url: string): void {
  iconCache.delete(url);
  inflight.delete(url);
  const listeners = subscribers.get(url);
  if (listeners) {
    listeners.forEach(fn => fn());
  }
}

function subscribeFaviconCache(url: string, listener: () => void): () => void {
  let set = subscribers.get(url);
  if (!set) {
    set = new Set();
    subscribers.set(url, set);
  }
  set.add(listener);
  return () => {
    const current = subscribers.get(url);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) subscribers.delete(url);
  };
}

export function isFaviconCached(url: string): boolean {
  return iconCache.has(url);
}

export async function prefetchFavicon(url: string, title?: string): Promise<void> {
  try {
    await fetchIcon(url, title);
  } catch {
    // ignore — prefetch is best-effort
  }
}

function escapeSvgText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function makeFallbackSvg(title?: string): string {
  const label = title?.trim() || '?';
  const initials = label.slice(0, 2).toUpperCase();
  const seed = Array.from(label).reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const hue = seed % 360;
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">',
    '<defs>',
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0%" stop-color="hsl(${String(hue)},70%,58%)"/>`,
    `<stop offset="100%" stop-color="hsl(${String((hue + 36) % 360)},68%,40%)"/>`,
    '</linearGradient></defs>',
    '<rect width="96" height="96" rx="24" fill="url(#g)"/>',
    `<text x="48" y="54" text-anchor="middle" font-family="system-ui,sans-serif" font-size="32" font-weight="700" fill="#FFF">${escapeSvgText(initials)}</text>`,
    '</svg>',
  ].join('');
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

async function fetchIcon(url: string, title?: string): Promise<string> {
  const cached = iconCache.get(url);
  if (cached) return cached;
  const inflightPromise = inflight.get(url);
  if (inflightPromise) return inflightPromise;
  const promise = (async () => {
    try {
      const icon = await getIcon(url, title);
      iconCache.set(url, icon.dataUrl);
      return icon.dataUrl;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, promise);
  return promise;
}

function radiusForShape(shape: TileShape): string {
  switch (shape) {
    case 'circle':  return '50%';
    case 'rounded': return '16%';
    case 'squircle':
    default:        return '22%';
  }
}

interface FaviconProps {
  url?: string;
  title?: string;
  shape?: TileShape;
}

export function Favicon({ url, title, shape = 'squircle' }: FaviconProps) {
  const [src, setSrc] = useState<string | null>(url ? (iconCache.get(url) ?? null) : null);
  const [version, setVersion] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!url) return;
    return subscribeFaviconCache(url, () => {
      if (mounted.current) setVersion(v => v + 1);
    });
  }, [url]);

  useEffect(() => {
    if (!url) {
      setSrc(null);
      return;
    }
    const cached = iconCache.get(url);
    if (cached) {
      setSrc(cached);
      return;
    }
    fetchIcon(url, title)
      .then(dataUrl => { if (mounted.current) setSrc(dataUrl); })
      .catch(() => { if (mounted.current) setSrc(makeFallbackSvg(title)); });
  }, [url, title, version]);

  const radius = radiusForShape(shape);

  return (
    <div
      className="ff-favicon"
      style={{
        width: '100%',
        height: '100%',
        borderRadius: radius,
        overflow: 'hidden',
        background: src ? 'transparent' : 'linear-gradient(180deg, var(--ink-3), var(--ink-2))',
        display: 'grid',
        placeItems: 'center',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <span style={{ color: 'var(--fg-3)', fontSize: '52%', fontWeight: 700 }}>
          {(title?.[0] ?? '?').toUpperCase()}
        </span>
      )}
    </div>
  );
}
