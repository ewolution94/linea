/**
 * The language (Dashboard's default, else the browser's, until one is picked in Settings), and the
 * strings.
 *
 * The strings are in `strings.ts`, English and German: `t('key', { n: 3 })` in a template updates
 * when the language changes.
 */

import { readConfig } from '../../vendor/ewo/elements/config-client.js';
import { themeShift } from '../../vendor/ewo/elements/theme-shift.js';
import { languageFor, ownLanguage } from './defaults.ts';
import { prefs, type Language } from './prefs.svelte.ts';
import { STRINGS } from './strings.ts';

export type Locale = 'en' | 'de';

/** The browser's language if it's one we have; English otherwise. */
function detect(): Locale {
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const base = tag?.toLowerCase().split('-')[0];
    if (base === 'de' || base === 'en') return base;
  }
  return 'en';
}

let system = $state<Locale>(detect());
addEventListener('languagechange', () => (system = detect()));

/** The family's key, `ewo:lang`: a pick for every app of the family on this device. */
const family = (() => {
  try {
    return localStorage.getItem('ewo:lang');
  } catch {
    return null;
  }
})();

/**
 * The language a pick shows: this device's own (made here, else the family's key), else Dashboard's
 * default, else the browser's.
 */
const wanted = (pick: Language): Locale => languageFor(ownLanguage(pick, family), readConfig().lang, system);

export function locale(): Locale {
  return wanted(prefs.language);
}

/** A pick in Settings: the page follows under Folio's veil (themeShift), unless the language on
 *  screen stays the same (Default → the language Default already shows). */
export function setLanguage(next: Language) {
  if (next === prefs.language) return;
  if (wanted(next) === locale()) prefs.language = next;
  else themeShift(() => (prefs.language = next));
}

$effect.root(() => {
  $effect(() => {
    document.documentElement.lang = locale();
  });
});

type Params = Record<string, string | number>;

/** `{name}` in a string takes `params.name`. */
export function fill(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/**
 * Strings by key. English is the reference: German may leave a key out,
 * and English shows for it. A key ending in `.one`/`.other` is a plural pair: pass `n` and the base.
 */
type PluralBase<T> = { [K in keyof T]: K extends `${infer B}.other` ? B : never }[keyof T];

export function words<const T extends Record<string, string>>(dict: { en: T; de: Partial<Record<keyof T, string>> }) {
  return (key: (keyof T & string) | PluralBase<T>, params?: Params): string => {
    const lang = locale();
    let k = key as string;
    if (params && 'n' in params && !(k in dict.en)) {
      const form = new Intl.PluralRules(lang).select(Number(params.n)) === 'one' ? 'one' : 'other';
      k = `${k}.${form}`;
    }
    const template = (dict[lang] as Record<string, string | undefined>)[k] ?? (dict.en as Record<string, string>)[k] ?? k;
    return fill(template, params);
  };
}

/** The shell's strings. */
export const t = words(STRINGS);

