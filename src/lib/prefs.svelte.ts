// This device's picks: the language, the week's first day and the name the others see (the theme lives
// in theme.svelte.ts, which boot.js mirrors before first paint). The name starts as the family's
// shared one (the ewo-me cookie on ewolution.cloud, which every game reads too).

import { sharedName, shareName } from '../../vendor/ewo/elements/emblem-shared.js';

export type Language = 'system' | 'en' | 'de';
export type WeekStart = 'auto' | 'monday' | 'sunday';

interface Prefs {
  language: Language;
  week: WeekStart;
  name: string;
}

const KEY = 'linea:prefs';
const DEFAULTS: Prefs = { language: 'system', week: 'auto', name: '' };

function load(): Prefs {
  let saved: Partial<Prefs> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {}
  const prefs = { ...DEFAULTS, ...saved };
  if (!prefs.name) {
    try {
      prefs.name = sharedName();
    } catch {}
  }
  return prefs;
}

export const prefs = $state<Prefs>(load());

/** What's open: the settings sheet. */
export const ui = $state({ settings: false });

/** Weeks start on Sunday where the device's region does (the US, Canada, Brazil, Japan …). */
function regionStartsSunday(): boolean {
  try {
    const tag = navigator.languages?.[0] ?? navigator.language;
    const info = (new Intl.Locale(tag) as unknown as { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } });
    const week = info.getWeekInfo?.() ?? info.weekInfo;
    if (week) return week.firstDay === 7;
    return /-(US|CA|BR|JP|MX|PH|IL|KR|TW|IN)$/i.test(tag);
  } catch {
    return false;
  }
}

export const mondayFirst = () => (prefs.week === 'auto' ? !regionStartsSunday() : prefs.week === 'monday');

export function setName(name: string) {
  prefs.name = name.replace(/\s+/g, ' ').trim().slice(0, 40);
  try {
    if (prefs.name) shareName(prefs.name);
  } catch {}
}

$effect.root(() => {
  $effect(() => {
    const snapshot = JSON.stringify(prefs);
    try {
      localStorage.setItem(KEY, snapshot);
    } catch {}
  });
});
