/**
 * What one page shows of a timeline: the zoom, the selection, what's being renamed, which sheet is
 * open. Shared by the header and the canvas; the canvas fills in the actions that need the scroller.
 * The zoom and the place each device was at are kept per timeline (`localStorage`).
 */

import { scaleAt, type Scale } from './layout.ts';

export type Sheet = null | 'item' | 'share' | 'lane' | 'people';

export class View {
  ppd = $state(6.8);
  sel = $state<string | null>(null);
  /** The item renamed in place (desktop). */
  editing = $state<string | null>(null);
  /** The lane renamed in place (desktop). */
  editLane = $state<string | null>(null);
  /** The lane the lane sheet is about. */
  lane = $state<string | null>(null);
  sheet = $state<Sheet>(null);
  scale: Scale = $derived(scaleAt(this.ppd));

  /** Filled in by the canvas. */
  zoomTo: (ppd: number) => void = () => {};
  toToday: () => void = () => {};
  add: () => void = () => {};
}

const KEY = (view: string) => `linea:view:${view}`;

export interface Place {
  ppd: number;
  /** The day at the left edge of the lanes. */
  day: number;
  top: number;
}

export function loadPlace(view: string): Place | null {
  try {
    const p = JSON.parse(localStorage.getItem(KEY(view)) ?? 'null');
    return p && Number.isFinite(p.ppd) && Number.isFinite(p.day) ? p : null;
  } catch {
    return null;
  }
}

export function keepPlace(view: string, place: Place) {
  try {
    localStorage.setItem(KEY(view), JSON.stringify(place));
  } catch {}
}
