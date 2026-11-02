/**
 * A timeline in and out: a picture of the whole plan (PNG, for slides), a file to keep or move (JSON),
 * reading such a file back, and the example plan for the home.
 *
 * The file spells dates out (`"from": "2026-11-02"`, `"to"` the last day, inclusive), so it reads
 * without Linea.
 */

import { cleanDoc, type Doc, type Item } from '../../shared/model.mjs';
import { addMonths, fromIso, iso, monthShort, monthStart, monthYear, short, today, weekStart } from './dates.ts';
import { DESK, layout, nameOf } from './layout.ts';
import { newId } from './board.svelte.ts';
import { t } from './i18n.svelte.ts';

const slug = (name: string) =>
  (name || 'timeline')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'timeline';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function toFile(doc: Doc) {
  return {
    linea: 1,
    name: doc.name,
    lanes: doc.lanes.map((l) => ({ id: l.id, name: l.name, colour: l.colour })),
    items: doc.items.map((i) => ({
      id: i.id,
      lane: i.lane,
      name: i.name,
      kind: i.kind,
      from: iso(i.start),
      to: iso(i.end - 1),
      colour: i.colour,
      note: i.note,
    })),
  };
}

export function saveJson(doc: Doc) {
  const blob = new Blob([JSON.stringify(toFile(doc), null, 2) + '\n'], { type: 'application/json' });
  download(blob, `${slug(doc.name)}.linea.json`);
}

/** A file read back: Linea's own, or a timeline as the server keeps it. Null if it's neither. */
export function fromFile(text: string): Doc | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as { items?: unknown[] };
  if (Array.isArray(data.items)) {
    data.items = data.items.map((value) => {
      const i = value as Record<string, unknown>;
      if (!i || typeof i !== 'object' || !('from' in i)) return i;
      const start = fromIso(i.from);
      const last = fromIso(i.to);
      return { ...i, start, end: last !== null && start !== null && last >= start ? last + 1 : start !== null ? start + 1 : null };
    });
  }
  const doc = cleanDoc(data);
  return doc && doc.lanes.length ? doc : null;
}

/** The example on the home: a shop relaunch, its kick-off four weeks ago. */
export function example(): Doc {
  const at = weekStart(today(), true) - 28;
  const lanes = t('example.lanes').split('|');
  const names = t('example.items').split('|');
  const ids = lanes.map(() => newId());
  // Offsets from the kick-off, as in the looks' plan; [lane, start, end] or [lane, day] for a milestone.
  const plan: [number, number, number?][] = [
    [0, 0],
    [0, 1, 20],
    [0, 7, 27],
    [0, 21, 41],
    [1, 21, 41],
    [1, 35, 62],
    [1, 42, 76],
    [1, 63],
    [2, 28, 48],
    [2, 49, 97],
    [2, 63, 104],
    [2, 105, 132],
    [3, 56, 111],
    [3, 64, 69],
    [4, 105],
    [4, 112, 146],
    [4, 140],
  ];
  const items: Item[] = plan.map(([lane, s, e], n) => ({
    id: newId(),
    lane: ids[lane],
    name: names[n] ?? '',
    start: at + s,
    end: e === undefined ? at + s + 7 : at + e,
    kind: e === undefined ? 'ms' : 'bar',
    colour: null,
    note: '',
  }));
  return { name: t('example.name'), lanes: lanes.map((name, i) => ({ id: ids[i], name, colour: i })), items };
}

/* ── the picture ── */

const INK = '#15171a';
const INK2 = '#575c63';
const RULE = '#dcddd9';
const LINES = ['#d8232a', '#157a3b', '#f3b300', '#1d63b8', '#8b4bb4'];
const ON_LINE = ['#ffffff', '#ffffff', '#1b1b1b', '#ffffff', '#ffffff'];
const FONT = (weight: number, size: number) => `${weight} ${size}px "Archivo Variable", "Helvetica Neue", Arial, sans-serif`;

/** The whole plan as a PNG on white, about 2,400 px of days wide, at twice that for sharpness. */
export async function savePng(doc: Doc) {
  await document.fonts?.ready;
  const now = today();
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of doc.items) {
    lo = Math.min(lo, i.start);
    hi = Math.max(hi, i.end);
  }
  if (!Number.isFinite(lo)) {
    lo = now;
    hi = now + 60;
  }
  const origin = monthStart(lo);
  const end = addMonths(monthStart(hi - 1), 1);
  const days = end - origin;
  const ppd = Math.max(1.2, Math.min(24, 2400 / days));
  const lw = 230;
  const g = { ...DESK, lw };
  const L = layout(doc, g, ppd, origin, days, t('item.untitled'));
  const head = 104;
  const axis = 40;
  const foot = 44;
  const W = Math.ceil(lw + days * ppd + 32);
  const H = Math.ceil(head + axis + L.height + foot);
  const scale = Math.min(2, 16000 / Math.max(W, H));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(W * scale);
  canvas.height = Math.ceil(H * scale);
  const c = canvas.getContext('2d')!;
  c.scale(scale, scale);
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, W, H);
  c.textBaseline = 'middle';

  // The name and the span.
  c.fillStyle = INK;
  c.font = FONT(800, 30);
  c.fillText(doc.name || t('board.untitled'), 32, 44);
  c.fillStyle = INK2;
  c.font = FONT(500, 15);
  c.fillText(`${short(origin)} ${monthYear(origin).replace(/^\S+\s/, '')} – ${short(end - 1)} ${monthYear(end - 1).replace(/^\S+\s/, '')}`, 32, 76);

  // The months.
  const top = head;
  const body = head + axis;
  c.font = FONT(800, 11.5);
  for (let s = origin; s < end; s = addMonths(s, 1)) {
    const x = L.x(s);
    const w = (addMonths(s, 1) - s) * ppd;
    c.fillStyle = INK;
    c.fillRect(x, top + 6, 2, axis - 12);
    c.fillStyle = RULE;
    c.fillRect(x, body, 1, L.height);
    c.fillStyle = INK;
    const label = w > 90 ? monthYear(s).toUpperCase() : monthShort(s).toUpperCase();
    if (w > 28) c.fillText(label, x + 8, top + axis / 2);
  }
  c.fillStyle = RULE;
  c.fillRect(0, body - 1, W, 1);

  // Today.
  if (now >= origin && now < end) {
    c.fillStyle = '#d8232a';
    c.fillRect(L.x(now) + ppd / 2 - 1, body, 2, L.height);
  }

  // The lanes: badge, name, rails.
  doc.lanes.forEach((lane, n) => {
    const box = L.lanes[n];
    const y = body + box.top;
    c.fillStyle = RULE;
    c.fillRect(0, y + box.h - 1, W, 1);
    const col = LINES[lane.colour] ?? LINES[0];
    c.globalAlpha = 0.28;
    c.fillStyle = col;
    for (let r = 0; r < box.rows; r++) roundRect(c, lw, y + g.pad + r * g.row + g.row / 2 - 2, days * ppd, 4, 2);
    c.globalAlpha = 1;
    const by = y + box.h / 2;
    c.fillStyle = col;
    roundRect(c, 16, by - 12, 34, 24, 6);
    c.fillStyle = ON_LINE[lane.colour] ?? '#fff';
    c.font = FONT(800, 12);
    c.textAlign = 'center';
    c.fillText(`M${n + 1}`, 33, by + 0.5);
    c.textAlign = 'left';
    c.fillStyle = INK;
    c.font = FONT(700, 14);
    c.fillText(clip(c, lane.name, lw - 74), 60, by + 0.5);
  });
  c.fillStyle = RULE;
  c.fillRect(lw - 1, body, 1, L.height);

  // The items.
  const laneColour = new Map(doc.lanes.map((l) => [l.id, l.colour]));
  for (const it of doc.items) {
    const box = L.at.get(it.id);
    if (!box) continue;
    const colour = it.colour ?? laneColour.get(it.lane) ?? 0;
    const y = body + box.y;
    const name = nameOf(it, t('item.untitled'));
    if (it.kind === 'ms') {
      c.fillStyle = '#ffffff';
      c.strokeStyle = INK;
      c.lineWidth = 4;
      c.beginPath();
      c.arc(box.x + 10, y + 12, 8, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = INK;
      c.font = FONT(800, 12.5);
      c.fillText(name, box.x + 26, y + 12.5);
    } else {
      c.fillStyle = LINES[colour];
      roundRect(c, box.x, y, box.w, 24, Math.min(12, box.w / 2));
      c.font = FONT(700, 12.5);
      if (box.out) {
        c.fillStyle = INK;
        c.fillText(name, box.x + box.w + 8, y + 12.5);
      } else {
        c.fillStyle = ON_LINE[colour];
        c.fillText(clip(c, name, box.w - 30), box.x + 15, y + 12.5);
      }
    }
  }

  c.fillStyle = INK2;
  c.font = FONT(600, 12);
  c.textAlign = 'right';
  c.fillText('Linea', W - 24, H - 22);

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (blob) download(blob, `${slug(doc.name)}.png`);
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, Math.max(0, w), h, r);
  c.fill();
}

function clip(c: CanvasRenderingContext2D, text: string, max: number) {
  if (c.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && c.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}
