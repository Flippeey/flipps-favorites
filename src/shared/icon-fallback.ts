// Pure, context-free fallback-icon generation shared by the background icon
// pipeline (createGeneratedRecord) and the newtab <Favicon> error fallback.
// Output is byte-compatible with the pre-refactor icon-service SVG so cached
// 'generated' records remain valid (no pipeline-version bump required).

export function escapeSvgText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function colorFromLabel(label: string): { start: string; end: string } {
  const seed = Array.from(label).reduce((total, character) => total + character.charCodeAt(0), 0);
  const hue = seed % 360;
  return {
    start: `hsl(${String(hue)} 70% 58%)`,
    end: `hsl(${String((hue + 36) % 360)} 68% 40%)`,
  };
}

export function buildFallbackSvgDataUrl(label: string): string {
  const initials = label.slice(0, 2).toUpperCase();
  const { start, end } = colorFromLabel(label);
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" aria-hidden="true">',
    '<defs>',
    `<linearGradient id="bookmark-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${start}" /><stop offset="100%" stop-color="${end}" /></linearGradient>`,
    '</defs>',
    '<rect width="96" height="96" rx="24" fill="url(#bookmark-gradient)" />',
    `<text x="48" y="54" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="32" font-weight="700" fill="#FFFFFF">${escapeSvgText(initials || '•')}</text>`,
    '</svg>',
  ].join('');
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
