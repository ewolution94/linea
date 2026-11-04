// Mirrors public/boot.js, which applies the theme before first paint; keep them in step. A device
// that hasn't picked one (Default) starts from Dashboard's default (src/lib/defaults.ts), and
// without one follows the system.
import { readConfig } from '../../vendor/ewo/elements/config-client.js';
import { themeShift } from '../../vendor/ewo/elements/theme-shift.js';
import { themeFor } from './defaults.ts';

export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'linea:theme';
const PAGE = { light: '#ffffff', dark: '#17191d' };
const media = matchMedia('(prefers-color-scheme: dark)');

function load(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** The pick, with Default standing for Dashboard's theme: light, dark, or `system`. */
const chosen = (pick: ThemePreference): ThemePreference => themeFor(pick, readConfig().theme);

class Theme {
  preference = $state<ThemePreference>(load());
  #systemDark = $state(media.matches);
  resolved = $derived.by<'light' | 'dark'>(() => {
    const picked = chosen(this.preference);
    return picked === 'system' ? (this.#systemDark ? 'dark' : 'light') : picked;
  });

  constructor() {
    media.addEventListener('change', (e) => (this.#systemDark = e.matches));
  }

  /** The control updates at once; the page follows under Folio's veil (themeShift), unless the
   *  pick changes nothing on screen (Default → what Default already shows). */
  set(next: ThemePreference) {
    if (next === this.preference) return;
    const before = this.resolved;
    this.preference = next;
    if (this.resolved === before) this.#apply(next);
    else themeShift(() => this.#apply(next));
  }

  #apply(next: ThemePreference) {
    const root = document.documentElement;
    const picked = chosen(next);
    if (picked === 'system') delete root.dataset.theme;
    else root.dataset.theme = picked;
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {}
    // Folio's --ewo-bg is a light-dark() pair, which a custom property reads back unresolved, so
    // the page colours are written out here (as in boot.js). "system" gives each meta its own.
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      const own = meta.media.includes('dark') ? 'dark' : 'light';
      meta.content = PAGE[picked === 'system' ? own : picked];
    }
  }
}

export const theme = new Theme();
