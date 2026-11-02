/**
 * The timelines this device has opened, newest first, for the home (`localStorage`, never sent). Each
 * keeps the links it was opened with and its name as last seen, plus the last copy of the timeline
 * itself, which opens read-only when there's no connection.
 */

import type { Doc } from '../../shared/model.mjs';

export interface Recent {
  /** The view key: both roles know it, so it names the timeline. */
  view: string;
  edit?: string;
  name: string;
  at: number;
}

const KEY = 'linea:recent';
const COPY = (view: string) => `linea:copy:${view}`;
const MAX = 60;

function load(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((r) => r && typeof r.view === 'string') : [];
  } catch {
    return [];
  }
}

export const recent = $state<{ list: Recent[] }>({ list: load() });

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(recent.list));
  } catch {}
}

/** Notes a timeline as opened (or renamed). An edit key, once known here, stays. */
export function remember(entry: { view: string; edit?: string; name: string }) {
  const old = recent.list.find((r) => r.view === entry.view);
  const next: Recent = { view: entry.view, edit: entry.edit ?? old?.edit, name: entry.name, at: Date.now() };
  recent.list = [next, ...recent.list.filter((r) => r.view !== entry.view)].slice(0, MAX);
  save();
}

/** New links: the entry follows them, its copy too. */
export function rekeyed(oldView: string, keys: { edit: string; view: string }) {
  const old = recent.list.find((r) => r.view === oldView);
  const copy = loadCopy(oldView);
  forget(oldView);
  remember({ view: keys.view, edit: keys.edit, name: old?.name ?? '' });
  if (copy) keepCopy(keys.view, copy.doc, copy.seq);
}

export function forget(view: string) {
  recent.list = recent.list.filter((r) => r.view !== view);
  save();
  try {
    localStorage.removeItem(COPY(view));
  } catch {}
}

export function keepCopy(view: string, doc: Doc, seq: number) {
  try {
    localStorage.setItem(COPY(view), JSON.stringify({ doc, seq }));
  } catch {
    // Storage full: the timeline still works, only not offline.
  }
}

export function loadCopy(view: string): { doc: Doc; seq: number } | null {
  try {
    const copy = JSON.parse(localStorage.getItem(COPY(view)) ?? 'null');
    return copy && copy.doc && Array.isArray(copy.doc.lanes) ? copy : null;
  } catch {
    return null;
  }
}

/** The view key a key belongs to, if this device has seen it (for an edit link opened offline). */
export const viewOf = (key: string) => recent.list.find((r) => r.view === key || r.edit === key)?.view ?? null;
