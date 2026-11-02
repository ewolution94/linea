/**
 * Where everything sits on the timeline: the scale, each lane's rows, and each item's box.
 *
 * Items that overlap stack in their lane on parallel tracks (greedy, earliest first), and a name too
 * long for its bar sits after it, so the next item on that track starts after the name.
 */

import type { Doc, Item } from '../../shared/model.mjs';

export interface Geometry {
  /** The lane names' column (0 on the phone, where names float over the lane). */
  lw: number;
  /** The axis's height. */
  ax: number;
  /** One track. */
  row: number;
  /** Above and below a lane's tracks. */
  pad: number;
  /** The phone's lane name above the tracks. */
  lab: number;
  /** Room under the last lane (the add button, the phone's + button). */
  tail: number;
}

export const DESK: Geometry = { lw: 196, ax: 54, row: 36, pad: 10, lab: 0, tail: 64 };
export const PHONE: Geometry = { lw: 0, ax: 46, row: 36, pad: 8, lab: 26, tail: 140 };
export const BAR = 24;
const GAP = 6;
/** A bar's name needs this much room besides itself (the stops at both ends). */
const NAME_PAD = 40;

export type Scale = 'week' | 'month' | 'quarter' | 'year';
export const SCALES: Scale[] = ['week', 'month', 'quarter', 'year'];
/** Pixels per day at each scale's button. Pinch and ⌘-scroll go anywhere between MIN and MAX. */
export const ZOOM: Record<'desk' | 'phone', Record<Scale, number>> = {
  desk: { week: 30, month: 6.8, quarter: 3.2, year: 1.6 },
  phone: { week: 28, month: 6, quarter: 2.6, year: 1.3 },
};
export const MIN_PPD = 0.9;
export const MAX_PPD = 64;

/** The scale whose axis fits a zoom level: days, weeks, months, or months under years. */
export function scaleAt(ppd: number): Scale {
  if (ppd >= 16) return 'week';
  if (ppd >= 4.4) return 'month';
  if (ppd >= 2.2) return 'quarter';
  return 'year';
}

const canvas = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
const widths = new Map<string, number>();
export const NAME_FONT = '700 12.5px "Archivo Variable", "Helvetica Neue", Arial, sans-serif';
export const MS_FONT = '800 12.5px "Archivo Variable", "Helvetica Neue", Arial, sans-serif';

/** A name's width in the item's font. */
export function textWidth(text: string, font = NAME_FONT): number {
  const key = font + '|' + text;
  let w = widths.get(key);
  if (w === undefined) {
    if (canvas) {
      canvas.font = font;
      w = Math.ceil(canvas.measureText(text).width);
    } else w = Math.ceil(text.length * 7.2);
    widths.set(key, w);
  }
  return w;
}
/** After the fonts load, every width is measured again. */
export const forgetWidths = () => widths.clear();

export interface Box {
  x: number;
  y: number;
  w: number;
  row: number;
  /** The name sits after the bar. */
  out: boolean;
}

export interface LaneBox {
  id: string;
  top: number;
  h: number;
  rows: number;
}

export interface Layout {
  g: Geometry;
  ppd: number;
  /** The first day drawn. */
  origin: number;
  days: number;
  /** A day's left edge on the canvas. */
  x: (day: number) => number;
  /** The canvas's width and the lanes' height. */
  width: number;
  height: number;
  lanes: LaneBox[];
  at: Map<string, Box>;
}

export const nameOf = (item: Pick<Item, 'name'>, untitled: string) => item.name || untitled;

/** Whether a bar this wide shows its name after itself. */
export const nameOutside = (item: Item, w: number, untitled: string) => item.kind !== 'ms' && textWidth(nameOf(item, untitled)) + NAME_PAD > w;

export function layout(doc: Doc, g: Geometry, ppd: number, origin: number, days: number, untitled: string): Layout {
  const x = (day: number) => g.lw + (day - origin) * ppd;
  const at = new Map<string, Box>();
  const lanes: LaneBox[] = [];
  const byLane = new Map<string, Item[]>();
  for (const item of doc.items) {
    const list = byLane.get(item.lane);
    if (list) list.push(item);
    else byLane.set(item.lane, [item]);
  }
  let top = 0;
  for (const lane of doc.lanes) {
    const items = (byLane.get(lane.id) ?? []).sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));
    const ends: number[] = [];
    for (const item of items) {
      const nameW = textWidth(nameOf(item, untitled), item.kind === 'ms' ? MS_FONT : NAME_FONT);
      let x0: number;
      let w: number;
      let x1: number;
      let out = false;
      if (item.kind === 'ms') {
        x0 = x(item.start) + ppd / 2 - 10;
        w = 20;
        x1 = x0 + 26 + nameW;
      } else {
        x0 = x(item.start);
        w = Math.max(2, (item.end - item.start) * ppd);
        out = nameOutside(item, w, untitled);
        x1 = x0 + w + (out ? nameW + 12 : 0);
      }
      let row = ends.findIndex((end) => end + GAP <= x0);
      if (row < 0) {
        row = ends.length;
        ends.push(x1);
      } else ends[row] = x1;
      at.set(item.id, { x: x0, y: 0, w, row, out });
    }
    const rows = Math.max(1, ends.length);
    const h = g.pad * 2 + g.lab + rows * g.row;
    for (const item of items) {
      const box = at.get(item.id)!;
      box.y = top + g.pad + g.lab + box.row * g.row + (g.row - BAR) / 2;
    }
    lanes.push({ id: lane.id, top, h, rows });
    top += h;
  }
  return { g, ppd, origin, days, x, width: g.lw + days * ppd, height: top, lanes, at };
}

/** The lane under a height on the canvas (the last one below them all). */
export const laneAt = (l: Layout, y: number) => l.lanes.find((lane) => y < lane.top + lane.h) ?? l.lanes[l.lanes.length - 1];
