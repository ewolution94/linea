<!--
  The timeline: the axis, the lanes and their items, and every drag on them (ported from the looks'
  mock, plans/linea/looks.html).

  Drags: move an item (also into another lane), stretch either end by its stop, draw a bar across an
  empty spot in a lane, reorder lanes by their grip. Everything snaps to whole days, the dates show
  beside the item while it moves, and the view scrolls when a drag reaches its edge. On a touch screen
  a plain drag scrolls and press-and-hold lifts an item. During a drag only the drag layer is redrawn
  and the pressed element stays in the page: iOS stops sending touch events to an element taken out.
-->
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { COLOURS, MAX_DAY, type Item, type Op } from '../../shared/model.mjs';
  import { CID, newId, type Board } from '../lib/board.svelte.ts';
  import { keepPlace, loadPlace, type View } from '../lib/view.svelte.ts';
  import { BAR, DESK, forgetWidths, laneAt, layout, MAX_PPD, MIN_PPD, nameOf, nameOutside, PHONE, textWidth, ZOOM, type Layout } from '../lib/layout.ts';
  import { addMonths, dateParts, isoWeek, monthShort, monthStart, monthYear, short, today, weekday, weekdayLetter, weekStart, withWeekday } from '../lib/dates.ts';
  import { mondayFirst } from '../lib/prefs.svelte.ts';
  import { t, locale } from '../lib/i18n.svelte.ts';
  import { toast } from '../../vendor/ewo/elements/toaster.js';

  let { board, view, phone }: { board: Board; view: View; phone: boolean } = $props();

  const LONG_PRESS = 340;
  const DOUBLE = 420;

  let sc: HTMLDivElement;
  let cv: HTMLDivElement;
  let fonts = $state(0);
  const TODAY = today();

  const g = $derived(phone ? PHONE : DESK);
  const doc = $derived(board.doc);
  const untitled = $derived(t('item.untitled'));
  const ro = $derived(board.readOnly);

  /** The days drawn: three months before the first item (or today) to ten after the last. */
  const range = $derived.by(() => {
    let lo = TODAY;
    let hi = TODAY;
    for (const it of doc.items) {
      if (it.start < lo) lo = it.start;
      if (it.end > hi) hi = it.end;
    }
    const origin = Math.max(0, addMonths(monthStart(lo), -3));
    const end = Math.min(MAX_DAY, addMonths(monthStart(hi), 10));
    return { origin, days: end - origin };
  });

  const L: Layout = $derived.by(() => {
    fonts;
    return layout(doc, g, view.ppd, range.origin, range.days, untitled);
  });

  const laneById = $derived(new Map(doc.lanes.map((l, i) => [l.id, { lane: l, n: i + 1 }])));
  const counts = $derived.by(() => {
    const m = new Map<string, number>();
    for (const it of doc.items) m.set(it.lane, (m.get(it.lane) ?? 0) + 1);
    return m;
  });
  const colourOf = (it: Pick<Item, 'colour' | 'lane'>) => it.colour ?? laneById.get(it.lane)?.lane.colour ?? 0;

  /* ── the axis and the grid ── */
  const AXIS_FONT = "600 11px 'Archivo Variable', sans-serif";
  interface Cell {
    s: number;
    e: number;
    a: string;
    b?: string;
    /** A shorter label for a column too narrow for `a`: the day alone. */
    n?: string;
    major?: boolean;
  }

  const axis = $derived.by(() => {
    locale();
    const { origin, days } = range;
    const end = origin + days;
    const scale = view.scale;
    const months: Cell[] = [];
    for (let s = origin; s < end; ) {
      const e = Math.min(end, addMonths(s, 1));
      months.push({ s, e, a: monthYear(s), b: monthShort(s) });
      s = e;
    }
    const group = (key: (c: Cell) => string): Cell[] => {
      const out: Cell[] = [];
      for (const m of months) {
        const k = key(m);
        const last = out[out.length - 1];
        if (last && last.a === k) last.e = m.e;
        else out.push({ s: m.s, e: m.e, a: k });
      }
      return out;
    };
    const quarter = (c: Cell) => {
      const p = dateParts(c.s);
      return `Q${Math.floor((p.m - 1) / 3) + 1} ${p.y}`;
    };
    const year = (c: Cell) => String(dateParts(c.s).y);
    let top: Cell[];
    let bottom: Cell[] = [];
    const monday = mondayFirst();
    if (scale === 'week' || scale === 'month') top = months.map((m) => ({ s: m.s, e: m.e, a: m.a }));
    else if (scale === 'quarter') top = group(quarter);
    else top = group(year);
    if (scale === 'week') {
      for (let d = origin; d < end; d++) bottom.push({ s: d, e: d + 1, a: String(dateParts(d).d), b: weekdayLetter(d) });
    } else if (scale === 'month') {
      for (let d = weekStart(origin, monday); d < end; d += 7) {
        bottom.push({ s: Math.max(origin, d), e: Math.min(end, d + 7), a: monday ? `W${isoWeek(d)}` : short(d), b: monday ? short(d) : '', n: String(dateParts(d).d) });
      }
    } else bottom = months.map((m) => ({ s: m.s, e: m.e, a: m.b! }));
    return { top, bottom, monday };
  });

  // Weeks too narrow for their dates show the day alone, all of them, under the month's name.
  const dayOnly = $derived(axis.bottom.some((c) => c.n && c.e - c.s === 7 && textWidth(c.a, AXIS_FONT) + 10 > 7 * view.ppd));

  const grid = $derived.by(() => {
    const { origin, days } = range;
    const end = origin + days;
    const major = new Set(axis.top.map((c) => c.s));
    const minor = axis.bottom.map((c) => c.s).filter((s) => !major.has(s));
    const weekends: number[] = [];
    if (view.scale === 'week' || view.scale === 'month') {
      for (let d = weekStart(origin, true) + 5; d < end; d += 7) weekends.push(d);
    }
    return { major: [...major], minor, weekends };
  });

  /* ── people ── */
  const others = $derived(board.people.filter((p) => p.cid !== CID));
  const holders = $derived(new Map(others.filter((p) => p.hold).map((p) => [p.hold!, p])));
  const hue = (cid: string) => [...cid].reduce((n, c) => n + c.charCodeAt(0), 0) % 6;

  /* ── place: restore, keep, today ── */
  let restored = false;
  let lastOrigin = 0;

  function leftDay() {
    return range.origin + sc.scrollLeft / view.ppd;
  }

  function scrollToDay(day: number, fraction = 0.3, smooth = false) {
    const visible = sc.clientWidth - g.lw;
    const left = Math.max(0, (day - range.origin) * view.ppd - visible * fraction);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    sc.scrollTo({ left, behavior: smooth && !reduce ? 'smooth' : 'auto' });
  }

  $effect(() => {
    if (!sc || restored || board.status !== 'ready' || !board.viewKey) return;
    restored = true;
    untrack(() => {
      const place = loadPlace(board.viewKey);
      if (place) {
        view.ppd = Math.min(MAX_PPD, Math.max(MIN_PPD, place.ppd));
        void tick().then(() => {
          sc.scrollLeft = (place.day - range.origin) * view.ppd;
          sc.scrollTop = place.top;
        });
      } else {
        view.ppd = ZOOM[phone ? 'phone' : 'desk'].month;
        void tick().then(() => scrollToDay(TODAY));
      }
      lastOrigin = range.origin;
    });
  });

  // An item moved before the first day drawn: the drawing grows to the left, and the view stays put.
  $effect(() => {
    const origin = range.origin;
    untrack(() => {
      if (lastOrigin && origin !== lastOrigin && sc) {
        const shift = (lastOrigin - origin) * view.ppd;
        void tick().then(() => (sc.scrollLeft += shift));
      }
      lastOrigin = origin;
    });
  });

  let placeTimer: ReturnType<typeof setTimeout> | undefined;
  function onScroll() {
    clearTimeout(placeTimer);
    placeTimer = setTimeout(() => {
      if (board.viewKey) keepPlace(board.viewKey, { ppd: view.ppd, day: leftDay(), top: sc.scrollTop });
    }, 400);
  }

  /** Zoom with a point on screen staying put (the middle of the lanes by default). */
  async function zoomAt(next: number, clientX?: number) {
    next = Math.min(MAX_PPD, Math.max(MIN_PPD, next));
    if (Math.abs(next - view.ppd) < 0.001) return;
    const rect = sc.getBoundingClientRect();
    const at = clientX === undefined ? g.lw + (sc.clientWidth - g.lw) / 2 : Math.max(g.lw, clientX - rect.left);
    const day = range.origin + (sc.scrollLeft + at - g.lw) / view.ppd;
    view.ppd = next;
    await tick();
    sc.scrollLeft = (day - range.origin) * next + g.lw - at;
    onScroll();
  }

  /* ── edits ── */
  function select(id: string | null) {
    view.sel = id;
    view.editing = null;
    if (id && phone) view.sheet = 'item';
  }

  function find(id: string | null) {
    return id ? doc.items.find((i) => i.id === id) : undefined;
  }

  function setItem(id: string, set: Partial<Item>) {
    board.change([{ op: 'item', id, set } as Op]);
  }

  function addItem(lane: string, start: number, end: number, edit = true) {
    const id = newId();
    const item: Item = { id, lane, name: t('board.newItem'), start, end, kind: 'bar', colour: null, note: '' };
    board.change([{ op: 'item+', item }]);
    view.sel = id;
    if (phone) view.sheet = 'item';
    else if (edit) view.editing = id;
    return id;
  }

  export function removeItem(id: string) {
    const it = find(id);
    if (!it) return;
    board.change([{ op: 'item-', id }]);
    if (view.sel === id) select(null);
    toast(t('item.deleted', { name: nameOf(it, untitled) }), { duration: 5000, action: { label: t('board.undo'), run: () => board.undo() } });
  }

  function duplicate(id: string) {
    const it = find(id);
    if (!it) return;
    const len = it.end - it.start;
    const copy: Item = { ...it, id: newId(), start: it.kind === 'ms' ? it.start + 1 : it.end, end: (it.kind === 'ms' ? it.start + 1 : it.end) + len };
    board.change([{ op: 'item+', item: copy }]);
    view.sel = copy.id;
    reveal(copy.id);
  }

  function nudge(id: string, days: number) {
    const it = find(id);
    if (!it) return;
    const len = it.end - it.start;
    const start = Math.max(range.origin, Math.min(MAX_DAY - len, it.start + days));
    setItem(id, { start, end: start + len });
    reveal(id);
  }

  function commitName(id: string, value: string) {
    view.editing = null;
    const it = find(id);
    const name = value.replace(/\s+/g, ' ').trim();
    if (it && name !== it.name) setItem(id, { name });
  }

  function commitLane(id: string, value: string) {
    view.editLane = null;
    const lane = laneById.get(id)?.lane;
    const name = value.replace(/\s+/g, ' ').trim();
    if (lane && name && name !== lane.name) board.change([{ op: 'lane', id, set: { name } }]);
  }

  function addLane() {
    const id = newId();
    board.change([{ op: 'lane+', lane: { id, name: t('board.newLane'), colour: doc.lanes.length % COLOURS }, at: null }]);
    if (!phone) view.editLane = id;
    else {
      view.lane = id;
      view.sheet = 'lane';
    }
    void tick().then(() => (sc.scrollTop = sc.scrollHeight));
  }

  /** Scrolls an item into view (the phone keeps it above the sheet). */
  function reveal(id: string) {
    void tick().then(() => {
      const box = L.at.get(id);
      if (!box || !sc) return;
      const visible = sc.clientWidth - g.lw;
      const left = box.x - g.lw;
      if (left < sc.scrollLeft || left + Math.min(box.w, visible * 0.6) > sc.scrollLeft + visible) sc.scrollLeft = left - 40;
      const room = sc.clientHeight - (view.sheet === 'item' && phone ? 460 : 40);
      const y = box.y + g.ax;
      if (y - sc.scrollTop > room || y < sc.scrollTop + g.ax) sc.scrollTop = Math.max(0, y - g.ax - 60);
    });
  }

  // The view object stays the same for the page's life.
  // svelte-ignore state_referenced_locally
  view.zoomTo = (ppd) => void zoomAt(ppd);
  // svelte-ignore state_referenced_locally
  view.toToday = () => scrollToDay(TODAY, 0.3, true);
  // svelte-ignore state_referenced_locally
  view.add = () => {
    if (ro || !doc.lanes.length) return;
    const lane = laneAt(L, sc.scrollTop + sc.clientHeight / 2 - g.ax);
    const mid = Math.floor(range.origin + (sc.scrollLeft + (sc.clientWidth - g.lw) / 2) / view.ppd);
    const id = addItem(lane.id, mid - 3, mid + 4, false);
    reveal(id);
  };

  // Something someone else deleted can't stay selected.
  $effect(() => {
    if (view.sel && !doc.items.some((i) => i.id === view.sel)) untrack(() => select(null));
  });

  /* ── pointer ── */
  type Mode = 'tap' | 'press' | 'pmove' | 'move' | 'resize' | 'pdraw' | 'draw' | 'ppan' | 'pan' | 'lane' | 'head' | 'none';
  /** The modes a pointer is still in when it lifts without having moved: a tap. */
  const TAPS = new Set<Mode>(['tap', 'press', 'pmove', 'pdraw', 'ppan', 'head']);
  interface Drag {
    pid: number;
    type: string;
    mode: Mode;
    x0: number;
    y0: number;
    cx: number;
    cy: number;
    sl: number;
    st: number;
    p0: { x: number; y: number };
    p: { x: number; y: number };
    id?: string;
    edge?: 's' | 'e';
    lane?: string;
    to?: number;
    onName?: boolean;
    gy?: number;
    orig?: { s: number; e: number; lane: string };
    tmp?: { s: number; e: number; lane: string; y?: number };
    timer?: ReturnType<typeof setTimeout>;
    raf?: number;
    L?: Layout;
  }
  interface DragView {
    mode: Mode;
    id?: string;
    item?: Item;
    x?: number;
    y?: number;
    w?: number;
    lane?: string;
    drop?: string;
    tag?: { x: number; y: number; text: string };
    ins?: number;
    ghostTop?: number;
  }

  let drag: Drag | null = null;
  let dv = $state.raw<DragView | null>(null);
  let last: { key: string; t: number } | null = null;
  const LIVE = new Set<Mode>(['move', 'resize', 'draw', 'lane']);

  const pt = (cx: number, cy: number) => {
    const r = cv.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top - g.ax };
  };
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const twice = (key: string) => {
    const now = performance.now();
    const hit = !!last && last.key === key && now - last.t < DOUBLE;
    last = hit ? null : { key, t: now };
    return hit;
  };
  const span = (s: number, e: number) => `${short(s)} – ${short(e - 1)} · ${t('item.days', { n: e - s })}`;

  function onDown(e: PointerEvent) {
    if (e.button > 0 || board.status !== 'ready') return;
    const target = e.target as HTMLElement;
    if (target.closest('input, button, textarea, .tb, .dtag')) return;
    if (view.editing) {
      const input = cv.querySelector<HTMLInputElement>('.it-in');
      if (input) commitName(view.editing, input.value);
    }
    if (view.editLane) {
      const input = cv.querySelector<HTMLInputElement>('.ln-in');
      if (input) commitLane(view.editLane, input.value);
    }
    const p = pt(e.clientX, e.clientY);
    const touchy = e.pointerType === 'touch' || phone;
    const itEl = target.closest<HTMLElement>('.it');
    const hEl = target.closest<HTMLElement>('.h');
    const grip = target.closest<HTMLElement>('.grip');
    const head = target.closest<HTMLElement>('.lh');
    const d: Drag = { pid: e.pointerId, type: e.pointerType, mode: 'tap', x0: e.clientX, y0: e.clientY, cx: e.clientX, cy: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop, p0: p, p };
    const it = itEl ? find(itEl.dataset.id!) : undefined;
    if (it && hEl && !ro && it.kind !== 'ms' && (!touchy || view.sel === it.id)) {
      Object.assign(d, { mode: 'resize', id: it.id, edge: hEl.dataset.h as 's' | 'e', orig: { s: it.start, e: it.end, lane: it.lane }, tmp: { s: it.start, e: it.end, lane: it.lane }, L });
      board.hold(it.id);
    } else if (grip && !phone && !ro) {
      const lane = grip.closest<HTMLElement>('.ln')!.dataset.lane!;
      Object.assign(d, { mode: 'lane', lane, to: doc.lanes.findIndex((l) => l.id === lane), L });
    } else if (head) {
      Object.assign(d, { mode: 'head', lane: head.closest<HTMLElement>('.ln')!.dataset.lane, onName: !!target.closest('.ln-n') });
    } else if (it) {
      d.id = it.id;
      if (touchy) {
        d.mode = 'press';
        if (!ro) d.timer = setTimeout(() => lift(d), LONG_PRESS);
      } else d.mode = ro ? 'tap' : 'pmove';
    } else if (!touchy && !ro && p.y >= 0 && p.y < L.height && p.x > g.lw && target.closest('.ln')) {
      d.mode = 'pdraw';
    } else if (e.pointerType === 'mouse' && p.y >= 0) d.mode = 'ppan';
    drag = d;
    if (e.pointerType !== 'touch' && d.mode !== 'press') e.preventDefault();
    if (LIVE.has(d.mode)) frame(d);
  }

  function startMove(d: Drag) {
    const it = find(d.id ?? null);
    const box = it && L.at.get(it.id);
    if (!it || !box) {
      d.mode = 'none';
      return;
    }
    Object.assign(d, { mode: 'move', L, gy: d.p0.y - box.y, orig: { s: it.start, e: it.end, lane: it.lane }, tmp: { s: it.start, e: it.end, lane: it.lane } });
    board.hold(it.id);
  }

  function lift(d: Drag) {
    if (drag !== d || d.mode !== 'press') return;
    startMove(d);
    try {
      navigator.vibrate?.(8);
    } catch {}
    frame(d);
  }

  function update(d: Drag) {
    const l = d.L ?? L;
    d.p = pt(d.cx, d.cy);
    const dd = Math.round((d.p.x - d.p0.x) / l.ppd);
    const lo = range.origin;
    const hi = range.origin + range.days;
    if (d.mode === 'move') {
      const it = find(d.id!)!;
      const len = d.orig!.e - d.orig!.s;
      const span = it.kind === 'ms' ? 1 : len;
      d.tmp!.s = clamp(d.orig!.s + dd, lo, hi - span);
      d.tmp!.e = d.tmp!.s + len;
      d.tmp!.lane = laneAt(l, d.p.y).id;
    } else if (d.mode === 'resize') {
      if (d.edge === 's') d.tmp!.s = clamp(d.orig!.s + dd, lo, d.orig!.e - 1);
      else d.tmp!.e = clamp(d.orig!.e + dd, d.orig!.s + 1, hi);
    } else if (d.mode === 'draw') {
      const day = (x: number) => clamp(lo + Math.floor((x - g.lw) / l.ppd), lo, hi - 1);
      const a = day(d.p0.x);
      const b = day(d.p.x);
      const lane = laneAt(l, d.p0.y);
      const row = clamp(Math.floor((d.p0.y - lane.top - g.pad - g.lab) / g.row), 0, lane.rows - 1);
      d.tmp = { s: Math.min(a, b), e: Math.max(a, b) + 1, lane: lane.id, y: lane.top + g.pad + g.lab + row * g.row + (g.row - BAR) / 2 };
    } else if (d.mode === 'lane') {
      const i = l.lanes.findIndex((lane) => d.p.y < lane.top + lane.h / 2);
      d.to = i < 0 ? l.lanes.length : i;
    }
  }

  function render(d: Drag) {
    const l = d.L ?? L;
    const tagAt = (x: number, y: number, text: string) => ({ x, y: y - 28 < 0 ? y + BAR + 6 : y - 28, text });
    if (d.mode === 'move') {
      const it = find(d.id!)!;
      const ms = it.kind === 'ms';
      const w = ms ? 20 : (d.tmp!.e - d.tmp!.s) * l.ppd;
      const x = ms ? l.x(d.tmp!.s) + l.ppd / 2 - 10 : l.x(d.tmp!.s);
      const y = clamp(d.p.y - d.gy!, 0, l.height - BAR);
      dv = { mode: 'move', id: it.id, item: { ...it, lane: d.tmp!.lane }, x, y, w, drop: d.tmp!.lane !== d.orig!.lane ? d.tmp!.lane : undefined, tag: tagAt(x, y, ms ? withWeekday(d.tmp!.s) : `${short(d.tmp!.s)} – ${short(d.tmp!.e - 1)}`) };
    } else if (d.mode === 'resize') {
      const box = l.at.get(d.id!)!;
      const x = l.x(d.tmp!.s);
      dv = { mode: 'resize', id: d.id, x, w: (d.tmp!.e - d.tmp!.s) * l.ppd, tag: tagAt(x, box.y, span(d.tmp!.s, d.tmp!.e)) };
    } else if (d.mode === 'draw') {
      const x = l.x(d.tmp!.s);
      dv = { mode: 'draw', x, y: d.tmp!.y, w: (d.tmp!.e - d.tmp!.s) * l.ppd, lane: d.tmp!.lane, tag: tagAt(x, d.tmp!.y!, span(d.tmp!.s, d.tmp!.e)) };
    } else if (d.mode === 'lane') {
      dv = { mode: 'lane', lane: d.lane, ins: d.to! < l.lanes.length ? l.lanes[d.to!].top : l.height, ghostTop: clamp(d.p.y - 17, 0, l.height) };
    }
  }

  /** One frame of a live drag: where it is, what it shows, and the view's scroll at an edge. */
  function frame(d: Drag) {
    if (d.raf) return;
    d.raf = requestAnimationFrame(() => {
      d.raf = 0;
      if (drag !== d || !LIVE.has(d.mode)) return;
      const r = sc.getBoundingClientRect();
      const edge = 36;
      let vx = 0;
      let vy = 0;
      if (d.mode !== 'lane') {
        if (d.cx < r.left + g.lw + edge) vx = -1;
        else if (d.cx > r.right - edge) vx = 1;
      }
      if (d.cy < r.top + g.ax + edge) vy = -1;
      else if (d.cy > r.bottom - edge) vy = 1;
      if (vx || vy) {
        sc.scrollLeft += vx * 14;
        sc.scrollTop += vy * 10;
      }
      update(d);
      render(d);
      if (vx || vy) frame(d);
    });
  }

  function onMove(e: PointerEvent) {
    const d = drag;
    if (!d || e.pointerId !== d.pid) return;
    d.cx = e.clientX;
    d.cy = e.clientY;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    const far = Math.hypot(dx, dy) > (d.type === 'touch' ? 8 : 4);
    if (d.mode === 'press' && far) {
      clearTimeout(d.timer);
      d.mode = d.type === 'mouse' ? 'pan' : 'none';
    } else if (d.mode === 'pmove' && far) startMove(d);
    else if (d.mode === 'pdraw' && far) {
      d.mode = 'draw';
      d.L = L;
    } else if (d.mode === 'ppan' && far) d.mode = 'pan';
    if (d.mode === 'pan') {
      sc.scrollLeft = d.sl - dx;
      sc.scrollTop = d.st - dy;
      return;
    }
    if (LIVE.has(d.mode)) frame(d);
  }

  function finish(d: Drag) {
    clearTimeout(d.timer);
    if (d.raf) cancelAnimationFrame(d.raf);
    if (d.mode === 'move' || d.mode === 'resize') board.hold(null);
    dv = null;
  }

  /** Eats the click a finger's tap sends after it lifts. A tap can open a sheet, and the browser finds
   *  that click's target afresh, so it would land on the new sheet's backdrop and close it again. */
  function swallowClick() {
    const eat = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      done();
    };
    const done = () => {
      clearTimeout(timer);
      removeEventListener('click', eat, true);
    };
    const timer = setTimeout(done, 600);
    addEventListener('click', eat, true);
  }

  function onUp(e: PointerEvent) {
    const d = drag;
    if (!d || e.pointerId !== d.pid) return;
    drag = null;
    if (LIVE.has(d.mode)) {
      d.cx = e.clientX;
      d.cy = e.clientY;
      update(d);
    }
    finish(d);
    if (d.type !== 'mouse' && TAPS.has(d.mode)) swallowClick();
    switch (d.mode) {
      case 'press':
        select(d.id!);
        if (phone) reveal(d.id!);
        return;
      case 'pmove':
        if (twice('it:' + d.id)) {
          view.sel = d.id!;
          view.editing = d.id!;
          return;
        }
        if (ro && phone) view.sheet = 'item';
        select(d.id!);
        return;
      case 'tap':
        if (d.id) {
          select(d.id);
          if (ro) view.sheet = 'item';
          return;
        }
        select(null);
        return;
      case 'head': {
        if (!phone && d.onName && !ro && twice('ln:' + d.lane)) {
          view.editLane = d.lane!;
          return;
        }
        if (phone) {
          view.lane = d.lane!;
          view.sheet = 'lane';
          return;
        }
        select(null);
        return;
      }
      case 'pdraw': {
        // A double-click on an empty spot adds a week from that day.
        const lane = laneAt(L, d.p0.y);
        const day = range.origin + Math.floor((d.p0.x - g.lw) / L.ppd);
        if (lane && twice(`bg:${lane.id}:${day}`)) addItem(lane.id, day, day + 7);
        else select(null);
        return;
      }
      case 'ppan':
        select(null);
        return;
      case 'move': {
        const it = find(d.id!);
        const tmp = d.tmp!;
        if (!it) return;
        if (tmp.s === d.orig!.s && tmp.lane === d.orig!.lane) {
          select(it.id);
          return;
        }
        board.change([{ op: 'item', id: it.id, set: { start: tmp.s, end: tmp.e, lane: tmp.lane } }]);
        view.sel = it.id;
        view.editing = null;
        return;
      }
      case 'resize': {
        const tmp = d.tmp!;
        if (find(d.id!) && (tmp.s !== d.orig!.s || tmp.e !== d.orig!.e)) setItem(d.id!, { start: tmp.s, end: tmp.e });
        return;
      }
      case 'draw':
        addItem(d.tmp!.lane, d.tmp!.s, d.tmp!.e);
        return;
      case 'lane': {
        const from = doc.lanes.findIndex((l) => l.id === d.lane);
        let to = d.to!;
        if (to > from) to--;
        if (to !== from && from >= 0) {
          const ids = doc.lanes.map((l) => l.id);
          ids.splice(from, 1);
          ids.splice(to, 0, d.lane!);
          board.change([{ op: 'order', ids }]);
        }
        return;
      }
    }
  }

  function onCancel(e: PointerEvent) {
    const d = drag;
    if (!d || e.pointerId !== d.pid) return;
    drag = null;
    finish(d);
  }

  /* ── keys ── */
  function onKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, ewo-sheet, [contenteditable]') || board.status !== 'ready') return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) board.redo();
      else board.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      board.redo();
      return;
    }
    if (mod && (e.key === '=' || e.key === '+' || e.key === '-')) {
      e.preventDefault();
      void zoomAt(view.ppd * (e.key === '-' ? 1 / 1.25 : 1.25));
      return;
    }
    const it = find(view.sel);
    if (!it) return;
    if (e.key === 'Escape') select(null);
    else if (ro) return;
    else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      removeItem(it.id);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      nudge(it.id, (e.shiftKey ? 7 : 1) * (e.key === 'ArrowLeft' ? -1 : 1));
    } else if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicate(it.id);
    } else if (e.key === 'Enter' && !phone) {
      e.preventDefault();
      view.editing = it.id;
    }
  }

  /* ── zoom: ⌘ or Ctrl with the wheel (a trackpad's pinch), and two fingers on a touch screen ── */
  function onWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    void zoomAt(view.ppd * Math.exp(-e.deltaY * 0.01), e.clientX);
  }

  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { d0: number; ppd0: number } | null = null;
  function pinchDown(e: PointerEvent) {
    if (e.pointerType !== 'touch') return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), ppd0: view.ppd };
      if (drag) {
        const d = drag;
        drag = null;
        finish(d);
      }
    }
  }
  function pinchMove(e: PointerEvent) {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinch || touches.size !== 2) return;
    const [a, b] = [...touches.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch.d0 > 0) void zoomAt(pinch.ppd0 * (dist / pinch.d0), (a.x + b.x) / 2);
  }
  function pinchUp(e: PointerEvent) {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
  }

  onMount(() => {
    const opts = { passive: false } as const;
    // While something is lifted, a finger's move drags it instead of scrolling the page.
    const touchMove = (e: TouchEvent) => {
      if ((drag && LIVE.has(drag.mode)) || pinch) e.preventDefault();
    };
    // Safari's own pinch (gesture events) would zoom the page: it zooms the timeline instead.
    let gesture0 = 0;
    const gestureStart = (e: Event) => {
      e.preventDefault();
      gesture0 = view.ppd;
    };
    const gestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale: number; clientX: number };
      void zoomAt(gesture0 * ge.scale, ge.clientX);
    };
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onCancel);
    addEventListener('pointerdown', pinchDown, true);
    addEventListener('pointermove', pinchMove, true);
    addEventListener('pointerup', pinchUp, true);
    addEventListener('pointercancel', pinchUp, true);
    addEventListener('keydown', onKey);
    document.addEventListener('touchmove', touchMove, opts);
    sc.addEventListener('wheel', onWheel, opts);
    sc.addEventListener('gesturestart', gestureStart);
    sc.addEventListener('gesturechange', gestureChange);
    void document.fonts?.ready.then(() => {
      forgetWidths();
      fonts++;
    });
    return () => {
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onCancel);
      removeEventListener('pointerdown', pinchDown, true);
      removeEventListener('pointermove', pinchMove, true);
      removeEventListener('pointerup', pinchUp, true);
      removeEventListener('pointercancel', pinchUp, true);
      removeEventListener('keydown', onKey);
      document.removeEventListener('touchmove', touchMove);
      sc.removeEventListener('wheel', onWheel);
      sc.removeEventListener('gesturestart', gestureStart);
      sc.removeEventListener('gesturechange', gestureChange);
      clearTimeout(placeTimer);
    };
  });

  function focusSelect(node: HTMLInputElement) {
    node.focus({ preventScroll: true });
    node.select();
  }

  /* ── the toolbar on the selected item (desktop) ── */
  const selItem = $derived(find(view.sel));
  const tbBox = $derived(selItem ? L.at.get(selItem.id) : undefined);
  let scrollLeft = $state(0);
  const tbLeft = $derived(tbBox ? Math.max(tbBox.x, Math.min(scrollLeft + g.lw + 8, tbBox.x + Math.max(0, tbBox.w - 60))) : 0);
  const tbTop = $derived(tbBox ? (tbBox.y - 50 < 2 ? tbBox.y + BAR + 12 : tbBox.y - 50) : 0);
  const itemSpan = (it: Item) => (it.kind === 'ms' ? withWeekday(it.start) : span(it.start, it.end));

  function setKind(it: Item, kind: 'bar' | 'ms') {
    if (it.kind === kind) return;
    setItem(it.id, { kind });
  }
</script>

<div
  class="sc"
  class:phone
  class:ro
  bind:this={sc}
  onscroll={() => {
    scrollLeft = sc.scrollLeft;
    onScroll();
  }}
  role="application"
  aria-label={t('board.canvas')}
>
  <!-- The keys live on the scroller around it (role application); this is the pointer's surface. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="cv" bind:this={cv} style:width="{L.width}px" style:--lw="{g.lw}px" style:--bar="{BAR}px" onpointerdown={onDown}>
    <div class="ax" style:height="{g.ax}px">
      {#if !phone}
        <div class="cn"><span>{t('board.lanes')}</span><span>{doc.lanes.length}</span></div>
      {/if}
      {#each axis.top as c (c.s)}
        <span class="t1" class:tiny={(c.e - c.s) * view.ppd < 44} style:left="{L.x(c.s)}px" style:width="{(c.e - c.s) * view.ppd}px"><b>{c.a}</b></span>
      {/each}
      {#each axis.bottom as c (c.s)}
        <span class="t2" class:tiny={(c.e - c.s) * view.ppd < (view.scale === 'month' ? 30 : 18)} style:left="{L.x(c.s)}px" style:width="{(c.e - c.s) * view.ppd}px"><b>{dayOnly && c.n ? c.n : c.a}</b>{#if c.b && (c.e - c.s) * view.ppd >= 40}<small>{c.b}</small>{/if}</span>
      {/each}
      {#if TODAY >= range.origin && TODAY < range.origin + range.days}
        <span class="tt" style:left="{L.x(TODAY) + view.ppd / 2}px">{t('board.today')}</span>
      {/if}
    </div>

    <div class="bd" style:height="{L.height + g.tail}px">
      <div class="gl" aria-hidden="true">
        {#each grid.weekends as d (d)}<i class="we" style:left="{L.x(d)}px" style:width="{2 * view.ppd}px"></i>{/each}
        {#each grid.minor as d (d)}<i class="gn" style:left="{L.x(d)}px"></i>{/each}
        {#each grid.major as d (d)}<i class="gm" style:left="{L.x(d)}px"></i>{/each}
        {#if TODAY >= range.origin && TODAY < range.origin + range.days}<i class="today-l" style:left="{L.x(TODAY) + view.ppd / 2}px"></i>{/if}
      </div>

      <div class="lns">
        {#each L.lanes as box (box.id)}
          {@const entry = laneById.get(box.id)!}
          <div class="ln" class:drop={dv?.drop === box.id} data-lane={box.id} style:top="{box.top}px" style:height="{box.h}px">
            <div class="lh">
              {#if !phone && !ro}<span class="grip" title={t('board.grip')}><Icon name="grip" size={16} /></span>{/if}
              <span class="bdg c{entry.lane.colour}">M{entry.n}</span>
              {#if view.editLane === box.id}
                <input
                  class="ln-in"
                  value={entry.lane.name}
                  aria-label={t('board.laneName')}
                  spellcheck="false"
                  maxlength="120"
                  use:focusSelect
                  onkeydown={(e) => {
                    if (e.key === 'Enter') commitLane(box.id, e.currentTarget.value);
                    else if (e.key === 'Escape') view.editLane = null;
                  }}
                  onblur={(e) => commitLane(box.id, e.currentTarget.value)}
                />
              {:else}
                <span class="ln-n">{entry.lane.name || t('board.newLane')}</span>
              {/if}
              {#if !phone}
                <span class="ln-k">{counts.get(box.id) ?? 0}</span>
                {#if !ro}
                  <button
                    type="button"
                    class="ln-m"
                    aria-label="{t('lane.menu')}: {entry.lane.name}"
                    onclick={() => {
                      view.lane = box.id;
                      view.sheet = 'lane';
                    }}><Icon name="more" size={16} /></button
                  >
                {/if}
              {/if}
            </div>
            {#each { length: box.rows } as _, r (r)}
              <i class="rail c{entry.lane.colour}" style:top="{g.pad + g.lab + r * g.row + g.row / 2 - 2}px" style:left="{g.lw}px" style:width="{range.days * view.ppd}px"></i>
            {/each}
          </div>
        {/each}
        {#if !ro}
          <div class="ln add" style:top="{L.height}px">
            <div class="lh">
              <button type="button" class="addl" onclick={addLane}><Icon name="plus" size={16} /><span>{phone ? t('board.addLaneShort') : t('board.addLane')}</span></button>
            </div>
          </div>
        {/if}
      </div>

      <div class="its">
        {#each doc.items as it (it.id)}
          {@const box = L.at.get(it.id)}
          {#if box}
            {@const live = dv?.mode === 'resize' && dv.id === it.id}
            {@const x = live ? dv!.x! : box.x}
            {@const w = live ? dv!.w! : box.w}
            {@const holder = holders.get(it.id)}
            <div
              class="it {it.kind === 'ms' ? 'ms' : 'bar'} c{colourOf(it)}"
              class:out={live ? nameOutside(it, w, untitled) : box.out}
              class:sel={view.sel === it.id && !dv}
              class:ghost={dv?.mode === 'move' && dv.id === it.id}
              class:remote={!!holder}
              style:left="{x}px"
              style:top="{box.y}px"
              style:width="{w}px"
              style:--p="var(--p{holder ? hue(holder.cid) : 0})"
              data-id={it.id}
              role="button"
              tabindex="0"
              aria-pressed={view.sel === it.id}
              aria-label={t('item.label', { name: nameOf(it, untitled), dates: itemSpan(it) })}
              onfocus={() => {
                if (view.sel !== it.id && !drag) view.sel = it.id;
              }}
              onkeydown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && phone) {
                  e.preventDefault();
                  select(it.id);
                }
              }}
            >
              {#if it.kind === 'ms'}
                <i class="ms-mark"></i>
              {:else}
                <i class="h hs" data-h="s"></i><i class="h he" data-h="e"></i>
              {/if}
              {#if view.editing === it.id && !phone}
                <input
                  class="it-in"
                  value={it.name}
                  aria-label={t('board.itemName')}
                  spellcheck="false"
                  maxlength="120"
                  use:focusSelect
                  onkeydown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') commitName(it.id, e.currentTarget.value);
                    else if (e.key === 'Escape') view.editing = null;
                  }}
                  onblur={(e) => commitName(it.id, e.currentTarget.value)}
                />
              {:else}
                <span class="it-l">{nameOf(it, untitled)}</span>
              {/if}
              {#if holder}<span class="rt">{holder.name || t('people.guest')}</span>{/if}
            </div>
          {/if}
        {/each}

        {#if selItem && tbBox && !phone && !view.editing && !dv && !ro}
          <div class="tb" role="toolbar" aria-label={t('tb.item')} style:left="{tbLeft}px" style:top="{tbTop}px">
            <span class="swatches">
              <button type="button" class="swatch lane c{laneById.get(selItem.lane)?.lane.colour ?? 0}" aria-label={t('tb.laneColour')} aria-pressed={selItem.colour === null} onclick={() => setItem(selItem.id, { colour: null })}></button>
              {#each { length: COLOURS } as _, c (c)}
                <button type="button" class="swatch c{c}" aria-label={t('tb.colour', { n: c + 1 })} aria-pressed={selItem.colour === c} onclick={() => setItem(selItem.id, { colour: c })}></button>
              {/each}
            </span>
            <span class="tb-d">{itemSpan(selItem)}</span>
            <button type="button" class="tb-b" aria-pressed={selItem.kind === 'ms'} onclick={() => setKind(selItem, selItem.kind === 'ms' ? 'bar' : 'ms')}><Icon name="station" size={15} /><span>{t('tb.milestone')}</span></button>
            <button type="button" class="tb-b" onclick={() => (view.sheet = 'item')}><Icon name="details" size={15} /><span>{t('tb.details')}</span></button>
            <button type="button" class="tb-b" aria-label={t('tb.delete')} title={t('tb.delete')} onclick={() => removeItem(selItem.id)}><Icon name="trash" size={15} /></button>
          </div>
        {/if}
      </div>

      <div class="drg" aria-hidden="true">
        {#if dv?.mode === 'move' && dv.item}
          {@const it = dv.item}
          <div class="it {it.kind === 'ms' ? 'ms' : 'bar'} c{colourOf(it)} lift" class:out={nameOutside(it, dv.w!, untitled)} style:left="{dv.x}px" style:top="{dv.y}px" style:width="{dv.w}px">
            {#if it.kind === 'ms'}<i class="ms-mark"></i>{:else}<i class="h hs"></i><i class="h he"></i>{/if}
            <span class="it-l">{nameOf(it, untitled)}</span>
          </div>
        {:else if dv?.mode === 'draw'}
          {@const lane = laneById.get(dv.lane!)}
          <div class="it bar c{lane?.lane.colour ?? 0} drawing" style:left="{dv.x}px" style:top="{dv.y}px" style:width="{dv.w}px"><i class="h hs"></i><i class="h he"></i></div>
        {:else if dv?.mode === 'lane'}
          {@const lane = laneById.get(dv.lane!)}
          <i class="ins" style:top="{dv.ins}px"></i>
          {#if lane}
            <div class="lghost" style:top="{dv.ghostTop}px" style:left="{scrollLeft + 8}px"><span class="bdg c{lane.lane.colour}">M{lane.n}</span><span>{lane.lane.name}</span></div>
          {/if}
        {/if}
        {#if dv?.tag}<span class="dtag" style:left="{dv.tag.x}px" style:top="{dv.tag.y}px">{dv.tag.text}</span>{/if}
      </div>

      {#if !doc.items.length && !ro && doc.lanes.length}
        <p class="hint" style:top="{L.height + 12}px" style:left="{scrollLeft + g.lw + 16}px">{phone ? t('board.emptyPhone') : t('board.empty')}</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .sc {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--rule) transparent;
    touch-action: pan-x pan-y;
  }

  .cv {
    position: relative;
    min-width: 100%;
    min-height: 100%;
    user-select: none;
    -webkit-user-select: none;
    font-size: 13px;
  }

  .ax {
    position: sticky;
    top: 0;
    z-index: 6;
    background: var(--axbg);
    border-bottom: 1px solid var(--rule);
  }

  .cn {
    position: sticky;
    left: 0;
    z-index: 3;
    box-sizing: border-box;
    width: var(--lw);
    height: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    padding: 0 14px 8px;
    background: var(--axbg);
    color: var(--ink2);
    border-right: 1px solid var(--rule);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 10.5px;
  }

  .t1,
  .t2 {
    position: absolute;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
    white-space: nowrap;
  }

  .t1 {
    top: 0;
    height: 50%;
    padding-left: 8px;
    font: 800 11.5px/1 var(--f);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    box-shadow: inset 2px 0 0 var(--ink);
  }

  .t2 {
    bottom: 0;
    height: 50%;
    padding-left: 6px;
    font: 600 11px/1 var(--f);
    color: var(--ink2);
    box-shadow: inset 1px 0 0 var(--rule);
  }

  .t2 small {
    font-weight: 500;
    font-size: 10.5px;
  }

  .t1.tiny > *,
  .t2.tiny > * {
    visibility: hidden;
  }

  .tt {
    position: absolute;
    bottom: 4px;
    transform: translateX(-50%);
    z-index: 1;
    padding: 3px 7px;
    border-radius: 999px;
    font: 700 9.5px/1 var(--f);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    background: var(--today);
    color: var(--tk);
    white-space: nowrap;
    pointer-events: none;
  }

  .bd {
    position: relative;
  }

  .gl,
  .lns,
  .its,
  .drg {
    position: absolute;
    inset: 0;
  }

  .gl,
  .its,
  .drg,
  .drg :global(*) {
    pointer-events: none !important;
  }

  .its > :global(*) {
    pointer-events: auto;
  }

  .gl i {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
  }

  .gl .gn {
    background: var(--g1);
  }

  .gl .gm {
    background: var(--g2);
  }

  .gl .we {
    background: var(--we);
  }

  .gl .today-l {
    width: 2px;
    margin-left: -1px;
    background: var(--today);
    z-index: 1;
  }

  .ln {
    position: absolute;
    left: 0;
    right: 0;
    border-bottom: 1px solid var(--rule);
  }

  .ln.drop {
    background: var(--dropbg);
  }

  .lh {
    position: sticky;
    left: 0;
    z-index: 4;
    box-sizing: border-box;
    width: var(--lw);
    height: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 6px 0 6px;
    background: var(--lhbg);
    border-right: 1px solid var(--rule);
  }

  .grip {
    width: 18px;
    height: 30px;
    display: grid;
    place-items: center;
    color: var(--ink2);
    cursor: grab;
    opacity: 0.6;
    touch-action: none;
    flex: none;
  }

  .bdg {
    min-width: 32px;
    height: 24px;
    box-sizing: border-box;
    padding: 0 5px;
    border-radius: 6px;
    background: var(--c);
    color: var(--k);
    display: grid;
    place-items: center;
    font: 800 12px/1 var(--f);
    flex: none;
  }

  .ln-n {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 700;
    font-size: 14px;
  }

  .ln-in {
    flex: 1 1 auto;
    min-width: 0;
    padding: 4px 6px;
    border: 0;
    border-radius: 4px;
    background: var(--pop);
    box-shadow: 0 0 0 1.5px var(--focus);
    outline: 0;
    font-weight: 700;
    font-size: 14px;
  }

  .ln-k {
    font-size: 11.5px;
    color: var(--ink2);
    font-variant-numeric: tabular-nums;
    flex: none;
  }

  .ln-m {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    color: var(--ink2);
    flex: none;
    opacity: 0;
  }

  .lh:hover .ln-m,
  .ln-m:focus-visible {
    opacity: 1;
  }

  .ln.add {
    height: 48px;
    border: 0;
  }

  .ln.add .lh {
    background: transparent;
    border: 0;
  }

  .addl {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px 0 6px;
    color: var(--ink2);
    font-weight: 600;
    border-radius: 6px;
    font-size: 13px;
  }

  .rail {
    position: absolute;
    height: 4px;
    border-radius: 2px;
    background: var(--c);
    opacity: var(--rail);
    pointer-events: none;
  }

  .phone .lh {
    width: max-content;
    max-width: calc(100vw - 32px);
    height: 24px;
    margin: 7px 0 0 8px;
    padding: 0 8px 0 3px;
    gap: 6px;
    border: 0;
    border-radius: 6px;
    font-size: 12.5px;
    font-weight: 600;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
    cursor: pointer;
  }

  .phone .bdg {
    min-width: 28px;
    height: 20px;
    font-size: 11px;
    border-radius: 5px;
  }

  .phone .ln-n {
    font-size: 12.5px;
  }

  .phone .ln.add .lh {
    height: 36px;
    margin-top: 8px;
    box-shadow: none;
  }

  .ins {
    position: absolute;
    left: 0;
    right: 0;
    height: 3px;
    margin-top: -1.5px;
    background: var(--focus);
    z-index: 7;
  }

  .lghost {
    position: absolute;
    z-index: 8;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 12px 0 8px;
    border-radius: 10px;
    background: var(--pop);
    color: var(--ink);
    box-shadow: 0 8px 22px rgb(0 0 0 / 0.22);
    font-weight: 700;
    white-space: nowrap;
  }

  /* Items: a section of the line with a stop at each end; a milestone an interchange station. */
  .it {
    position: absolute;
    z-index: 2;
    height: var(--bar);
    cursor: grab;
    touch-action: pan-x pan-y;
    -webkit-touch-callout: none;
    outline-offset: 3px;
  }

  .ro .it {
    cursor: pointer;
  }

  .it-l {
    position: absolute;
    white-space: nowrap;
    pointer-events: none;
  }

  .bar {
    border-radius: 12px;
    background: var(--c);
  }

  .bar .it-l {
    left: 17px;
    right: 17px;
    overflow: hidden;
    text-overflow: ellipsis;
    font: 700 12.5px/24px var(--f);
    color: var(--k);
  }

  .bar.out .it-l {
    left: calc(100% + 8px);
    right: auto;
    overflow: visible;
    color: var(--ink);
  }

  .h {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 14px;
    z-index: 1;
    cursor: ew-resize;
    touch-action: none;
  }

  .ro .h {
    cursor: inherit;
  }

  .hs {
    left: -7px;
  }

  .he {
    right: -7px;
  }

  .phone .it:not(.sel) .h {
    pointer-events: none;
  }

  .bar .h::before {
    content: '';
    position: absolute;
    top: 11px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--k);
  }

  .bar .hs::before {
    left: 13px;
  }

  .bar .he::before {
    right: 13px;
  }

  .bar.sel {
    box-shadow:
      0 0 0 2px var(--ground),
      0 0 0 4px var(--ink);
  }

  .sel .h::before {
    width: 12px;
    height: 12px;
    top: 8px;
    box-sizing: border-box;
    background: var(--st);
    border: 2.5px solid var(--ink);
  }

  .sel .hs::before {
    left: 10px;
  }

  .sel .he::before {
    right: 10px;
  }

  .ms {
    width: 20px;
  }

  .ms-mark {
    position: absolute;
    left: 0;
    top: 2px;
    width: 20px;
    height: 20px;
    box-sizing: border-box;
    border-radius: 50%;
    background: var(--st);
    border: 4px solid var(--ink);
  }

  .ms .it-l {
    left: 26px;
    font: 800 12.5px/24px var(--f);
    color: var(--ink);
  }

  .ms.sel .ms-mark {
    box-shadow:
      0 0 0 3px var(--ground),
      0 0 0 5.5px var(--c);
  }

  .it.ghost {
    opacity: 0.25;
  }

  .it.lift {
    z-index: 6;
    cursor: grabbing;
    box-shadow: 0 10px 24px rgb(0 0 0 / 0.28);
  }

  .ms.lift {
    box-shadow: none;
  }

  .ms.lift .ms-mark {
    box-shadow: 0 8px 18px rgb(0 0 0 / 0.3);
  }

  .it.drawing {
    opacity: 0.75;
  }

  .it.remote {
    outline: 2px solid var(--p);
    outline-offset: 2px;
  }

  .rt {
    position: absolute;
    left: -4px;
    top: -22px;
    padding: 4px 6px;
    border-radius: 4px 4px 4px 0;
    font: 700 10.5px/1 var(--f);
    background: var(--p);
    color: var(--pk);
    white-space: nowrap;
    pointer-events: none;
  }

  .it-in {
    position: absolute;
    z-index: 3;
    left: 0;
    top: -3px;
    box-sizing: border-box;
    height: calc(100% + 6px);
    width: max(220px, calc(100% + 24px));
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    outline: 0;
    background: var(--pop);
    color: var(--ink);
    box-shadow:
      0 0 0 1.5px var(--focus),
      0 6px 18px rgb(0 0 0 / 0.16);
    font-weight: 600;
    font-size: 13px;
    cursor: text;
    user-select: text;
    -webkit-user-select: text;
  }

  .dtag {
    position: absolute;
    z-index: 9;
    padding: 4px 8px;
    border-radius: 999px;
    font: 600 11px/1 var(--f);
    font-variant-numeric: tabular-nums;
    background: var(--ink);
    color: var(--ground);
    white-space: nowrap;
  }

  .tb {
    position: absolute;
    z-index: 9;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 999px;
    background: var(--pop);
    color: var(--ink);
    white-space: nowrap;
    font-size: 12px;
    box-shadow:
      0 8px 24px var(--shadow),
      0 0 0 1px var(--rule);
  }

  .tb .swatches {
    gap: 5px;
    padding: 0 8px 0 2px;
    border-right: 1px solid var(--rule);
  }

  .tb .swatch {
    width: 18px;
    height: 18px;
  }

  .tb-d {
    padding: 0 4px;
    color: var(--ink2);
    font-variant-numeric: tabular-nums;
  }

  .tb-b {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 9px;
    border-radius: 999px;
  }

  .tb-b[aria-pressed='true'] {
    background: var(--ink);
    color: var(--pop);
  }

  .hint {
    position: absolute;
    color: var(--ink2);
    font-size: 13px;
    pointer-events: none;
    white-space: nowrap;
  }

  @media (hover: hover) and (pointer: fine) {
    .addl:hover,
    .ln-m:hover,
    .tb-b:not([aria-pressed='true']):hover {
      background: var(--hov);
    }

    .grip:hover {
      opacity: 1;
    }
  }
</style>
