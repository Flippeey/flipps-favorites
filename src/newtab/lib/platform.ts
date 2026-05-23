// Platform detection + keyboard shortcut glyph helpers shared across newtab UI.
// Centralised so onboarding / settings / nav / search all render the same labels.

export const IS_MAC: boolean =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export const MOD_KEY: string = IS_MAC ? '⌘' : 'Ctrl';
export const ALT_KEY: string = IS_MAC ? '⌥' : 'Alt';

export function modShortcut(letter: string): string {
  return IS_MAC ? `${MOD_KEY}${letter}` : `${MOD_KEY}+${letter}`;
}

export function altShortcut(letter: string): string {
  return IS_MAC ? `${ALT_KEY}${letter}` : `${ALT_KEY}+${letter}`;
}
