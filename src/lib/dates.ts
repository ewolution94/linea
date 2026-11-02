/**
 * Days as whole UTC days since 1 January 1970 (shared/model.mjs), so a plan's dates never move with
 * the viewer's time zone. Today is the viewer's own date.
 */

import { locale } from './i18n.svelte.ts';

export const MS_DAY = 86_400_000;

export const dayOf = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
const utc = (day: number) => new Date(day * MS_DAY);

export function today(): number {
  const now = new Date();
  return dayOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** 0 Sunday … 6 Saturday. */
export const weekday = (day: number) => (day + 4) % 7;
export const dateParts = (day: number) => {
  const d = utc(day);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};

/** The first day of the month `day` is in, and of the following ones. */
export const monthStart = (day: number) => {
  const p = dateParts(day);
  return dayOf(p.y, p.m, 1);
};
export const addMonths = (day: number, n: number) => {
  const p = dateParts(day);
  return dayOf(p.y, p.m + n, 1);
};

/** ISO 8601 week number (weeks start on Monday; week 1 holds the year's first Thursday). */
export function isoWeek(day: number): number {
  const thursday = day - ((weekday(day) + 6) % 7) + 3;
  const year = dateParts(thursday).y;
  return Math.floor((thursday - dayOf(year, 1, 1)) / 7) + 1;
}

/** The week's first day: Monday, or Sunday where weeks start on Sunday. */
export const weekStart = (day: number, monday: boolean) => day - (monday ? (weekday(day) + 6) % 7 : weekday(day));

const formats = new Map<string, Intl.DateTimeFormat>();
function format(day: number, options: Intl.DateTimeFormatOptions): string {
  const lang = locale();
  const key = lang + JSON.stringify(options);
  let f = formats.get(key);
  if (!f) formats.set(key, (f = new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { timeZone: 'UTC', ...options })));
  return f.format(utc(day));
}

/** 2 Nov */
export const short = (day: number) => format(day, { day: 'numeric', month: 'short' });
/** Mon 2 Nov */
export const withWeekday = (day: number) => format(day, { weekday: 'short', day: 'numeric', month: 'short' });
/** Mon 2 Nov 2026 */
export const full = (day: number) => format(day, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
/** November 2026 */
export const monthYear = (day: number) => format(day, { month: 'long', year: 'numeric' });
/** Nov */
export const monthShort = (day: number) => format(day, { month: 'short' });
/** M, T, W… */
export const weekdayLetter = (day: number) => format(day, { weekday: 'narrow' });

/** 2026-11-02, for files. */
export const iso = (day: number) => utc(day).toISOString().slice(0, 10);
export function fromIso(text: unknown): number | null {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [y, m, d] = text.split('-').map(Number);
  const day = dayOf(y, m, d);
  return iso(day) === text ? day : null;
}
