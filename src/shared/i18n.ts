import { en } from '../locales/en';
import type { TranslationKey } from '../locales/en';

type Params = Record<string, string | number>;

/**
 * Look up a translation key and optionally interpolate named placeholders.
 *
 * Placeholders use {braces} syntax, e.g.:
 *   t('bookmark.dialog.status.saved', { name: 'GitHub' })
 *   → "Saved bookmark GitHub."
 */
export function t(key: TranslationKey, params?: Params): string {
  const raw: string = en[key];
  if (!params) {
    return raw;
  }
  return raw.replace(/\{(\w+)\}/g, (_, token: string) => {
    const value = params[token];
    return value !== undefined ? String(value) : `{${token}}`;
  });
}

/**
 * Plural-aware lookup. The string value must contain exactly one " | " separator:
 *   "singular form | plural form"
 *
 * Placeholders in both forms are interpolated after the right form is chosen.
 * {_count} is automatically available as the count value.
 *
 * Example:
 *   tp('status.paste.done', 1)         → "Pasted 1 item."
 *   tp('status.paste.done', 3, { count: 3 }) → "Pasted 3 items."
 *
 * (When using {count} in the string, pass count in params too.)
 */
export function tp(key: TranslationKey, count: number, params?: Params): string {
  const raw: string = en[key];
  const pipeIndex = raw.indexOf(' | ');
  const singular = pipeIndex >= 0 ? raw.slice(0, pipeIndex) : raw;
  const plural = pipeIndex >= 0 ? raw.slice(pipeIndex + 3) : raw;
  const form = count === 1 ? singular : plural;
  const merged: Params = { _count: count, ...params };
  return form.replace(/\{(\w+)\}/g, (_, token: string) => {
    const value = merged[token];
    return value !== undefined ? String(value) : `{${token}}`;
  });
}
