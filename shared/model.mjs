// A timeline and the operations that change it, shared by the server and the page.
//
// A timeline is { name, lanes, items }. Lanes are rows in their order; items are bars (whole days from
// `start` up to, not including, `end`) and milestones (one day, `start`; their `end` keeps the bar's
// length for when one becomes a bar again). Days are whole UTC days since 1 January 1970, so a date
// never moves with the viewer's time zone.
//
// Every change is an operation. The page applies its own at once; the server numbers them in the order
// they arrive, saves them and passes them on, and the last write wins per field. An operation on
// something that's gone (an item someone deleted meanwhile) changes nothing.

export const LIMITS = {
  items: 2000,
  lanes: 50,
  /** The saved timeline, as JSON. */
  bytes: 1_000_000,
  name: 120,
  note: 2000,
  /** Operations in one request. */
  batch: 200,
};

/** Lane and item colours: the five lines of the Metro look. */
export const COLOURS = 5;
/** 1 January 1970 to 31 December 2199. */
export const MIN_DAY = 0;
export const MAX_DAY = 84_005;

const ID = /^[A-Za-z0-9_-]{1,24}$/;
const isId = (v) => typeof v === 'string' && ID.test(v);
const isDay = (v) => Number.isInteger(v) && v >= MIN_DAY && v <= MAX_DAY;
const isColour = (v) => Number.isInteger(v) && v >= 0 && v < COLOURS;
const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max) : null);
const line = (v, max) => {
  const t = text(v, max);
  return t === null ? null : t.replace(/\s+/g, ' ').trim();
};

/** A lane as it may be stored, or null. */
export function cleanLane(raw) {
  if (!raw || typeof raw !== 'object' || !isId(raw.id)) return null;
  const name = line(raw.name, LIMITS.name);
  return { id: raw.id, name: name ?? '', colour: isColour(raw.colour) ? raw.colour : 0 };
}

/** An item as it may be stored, or null. */
export function cleanItem(raw) {
  if (!raw || typeof raw !== 'object' || !isId(raw.id) || !isId(raw.lane) || !isDay(raw.start) || raw.start >= MAX_DAY) return null;
  return {
    id: raw.id,
    lane: raw.lane,
    name: line(raw.name, LIMITS.name) ?? '',
    start: raw.start,
    end: isDay(raw.end) && raw.end > raw.start ? raw.end : raw.start + 1,
    kind: raw.kind === 'ms' ? 'ms' : 'bar',
    colour: isColour(raw.colour) ? raw.colour : null,
    note: text(raw.note, LIMITS.note) ?? '',
  };
}

/** A whole timeline (an import, a snapshot) made safe, or null if it isn't one. */
export function cleanDoc(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.lanes) || !Array.isArray(raw.items)) return null;
  const lanes = [];
  const laneIds = new Set();
  for (const l of raw.lanes.slice(0, LIMITS.lanes)) {
    const lane = cleanLane(l);
    if (lane && !laneIds.has(lane.id)) laneIds.add(lane.id), lanes.push(lane);
  }
  const items = [];
  const itemIds = new Set();
  for (const i of raw.items) {
    if (items.length >= LIMITS.items) break;
    const item = cleanItem(i);
    if (item && laneIds.has(item.lane) && !itemIds.has(item.id)) itemIds.add(item.id), items.push(item);
  }
  return { name: line(raw.name, LIMITS.name) ?? '', lanes, items };
}

const LANE_FIELDS = { name: (v) => line(v, LIMITS.name), colour: (v) => (isColour(v) ? v : null) };
const ITEM_FIELDS = {
  lane: (v) => (isId(v) ? v : null),
  name: (v) => line(v, LIMITS.name),
  start: (v) => (isDay(v) && v < MAX_DAY ? v : null),
  end: (v) => (isDay(v) ? v : null),
  kind: (v) => (v === 'ms' || v === 'bar' ? v : null),
  // null puts an item back to its lane's colour.
  colour: (v) => (v === null ? null : isColour(v) ? v : undefined),
  note: (v) => text(v, LIMITS.note),
};

function cleanSet(raw, fields) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [key, check] of Object.entries(fields)) {
    if (!(key in raw)) continue;
    const value = check(raw[key]);
    if (value === undefined || (value === null && key !== 'colour')) return null;
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * An operation as it may be applied, or null. The shapes:
 *
 *   { op: 'name', name }                       the timeline's name
 *   { op: 'lane+', lane, at, items? }          a lane at an index (with its items, when undoing a delete)
 *   { op: 'lane', id, set: { name?, colour? } }
 *   { op: 'lane-', id }                        a lane and its items
 *   { op: 'order', ids }                       the lanes' order
 *   { op: 'item+', item }
 *   { op: 'item', id, set: { lane?, name?, start?, end?, kind?, colour?, note? } }
 *   { op: 'item-', id }
 */
export function cleanOp(raw) {
  if (!raw || typeof raw !== 'object') return null;
  switch (raw.op) {
    case 'name': {
      const name = line(raw.name, LIMITS.name);
      return name === null ? null : { op: 'name', name };
    }
    case 'lane+': {
      const lane = cleanLane(raw.lane);
      if (!lane) return null;
      const at = Number.isInteger(raw.at) && raw.at >= 0 ? raw.at : null;
      const items = Array.isArray(raw.items) ? raw.items.slice(0, LIMITS.items).map(cleanItem).filter((i) => i && i.lane === lane.id) : [];
      return { op: 'lane+', lane, at, items };
    }
    case 'lane': {
      const set = isId(raw.id) && cleanSet(raw.set, LANE_FIELDS);
      return set ? { op: 'lane', id: raw.id, set } : null;
    }
    case 'lane-':
    case 'item-':
      return isId(raw.id) ? { op: raw.op, id: raw.id } : null;
    case 'order':
      return Array.isArray(raw.ids) && raw.ids.length <= LIMITS.lanes * 2 && raw.ids.every(isId) ? { op: 'order', ids: raw.ids } : null;
    case 'item+': {
      const item = cleanItem(raw.item);
      return item ? { op: 'item+', item } : null;
    }
    case 'item': {
      const set = isId(raw.id) && cleanSet(raw.set, ITEM_FIELDS);
      return set ? { op: 'item', id: raw.id, set } : null;
    }
    default:
      return null;
  }
}

/** Applies a clean operation to a timeline in place. Returns whether anything changed. */
export function apply(doc, op) {
  switch (op.op) {
    case 'name':
      if (doc.name === op.name) return false;
      doc.name = op.name;
      return true;
    case 'lane+': {
      if (doc.lanes.some((l) => l.id === op.lane.id)) return false;
      const at = op.at === null ? doc.lanes.length : Math.min(op.at, doc.lanes.length);
      doc.lanes.splice(at, 0, { ...op.lane });
      const have = new Set(doc.items.map((i) => i.id));
      for (const item of op.items ?? []) if (!have.has(item.id)) doc.items.push({ ...item });
      return true;
    }
    case 'lane': {
      const lane = doc.lanes.find((l) => l.id === op.id);
      if (!lane) return false;
      let changed = false;
      for (const [k, v] of Object.entries(op.set)) if (lane[k] !== v) (lane[k] = v), (changed = true);
      return changed;
    }
    case 'lane-': {
      const at = doc.lanes.findIndex((l) => l.id === op.id);
      if (at < 0) return false;
      doc.lanes.splice(at, 1);
      doc.items = doc.items.filter((i) => i.lane !== op.id);
      return true;
    }
    case 'order': {
      const byId = new Map(doc.lanes.map((l) => [l.id, l]));
      const next = [];
      for (const id of op.ids) if (byId.has(id)) next.push(byId.get(id)), byId.delete(id);
      // A lane someone added meanwhile keeps its place at the end.
      next.push(...byId.values());
      if (next.every((l, i) => l === doc.lanes[i])) return false;
      doc.lanes = next;
      return true;
    }
    case 'item+': {
      if (doc.items.some((i) => i.id === op.item.id) || !doc.lanes.some((l) => l.id === op.item.lane)) return false;
      doc.items.push({ ...op.item });
      return true;
    }
    case 'item': {
      const item = doc.items.find((i) => i.id === op.id);
      if (!item) return false;
      const next = { ...item, ...op.set };
      if ('lane' in op.set && !doc.lanes.some((l) => l.id === next.lane)) next.lane = item.lane;
      // Two people stretching the two ends at once can cross them: keep at least a day.
      if (next.end <= next.start) next.end = Math.min(MAX_DAY, next.start + Math.max(1, item.end - item.start));
      let changed = false;
      for (const k of Object.keys(next)) if (item[k] !== next[k]) (item[k] = next[k]), (changed = true);
      return changed;
    }
    case 'item-': {
      const at = doc.items.findIndex((i) => i.id === op.id);
      if (at < 0) return false;
      doc.items.splice(at, 1);
      return true;
    }
  }
  return false;
}

/** The operations that undo `ops` on `doc` (as it was before them), in the order to apply them. */
export function inverse(doc, ops) {
  const work = structuredClone(doc);
  const back = [];
  for (const op of ops) {
    back.unshift(...undoOf(work, op));
    apply(work, op);
  }
  return back;
}

function undoOf(doc, op) {
  switch (op.op) {
    case 'name':
      return [{ op: 'name', name: doc.name }];
    case 'lane+':
      return doc.lanes.some((l) => l.id === op.lane.id) ? [] : [{ op: 'lane-', id: op.lane.id }];
    case 'lane': {
      const lane = doc.lanes.find((l) => l.id === op.id);
      if (!lane) return [];
      return [{ op: 'lane', id: op.id, set: Object.fromEntries(Object.keys(op.set).map((k) => [k, lane[k]])) }];
    }
    case 'lane-': {
      const at = doc.lanes.findIndex((l) => l.id === op.id);
      if (at < 0) return [];
      return [{ op: 'lane+', lane: { ...doc.lanes[at] }, at, items: doc.items.filter((i) => i.lane === op.id).map((i) => ({ ...i })) }];
    }
    case 'order':
      return [{ op: 'order', ids: doc.lanes.map((l) => l.id) }];
    case 'item+':
      return doc.items.some((i) => i.id === op.item.id) ? [] : [{ op: 'item-', id: op.item.id }];
    case 'item': {
      const item = doc.items.find((i) => i.id === op.id);
      if (!item) return [];
      return [{ op: 'item', id: op.id, set: Object.fromEntries(Object.keys(op.set).map((k) => [k, item[k]])) }];
    }
    case 'item-': {
      const item = doc.items.find((i) => i.id === op.id);
      return item ? [{ op: 'item+', item: { ...item } }] : [];
    }
  }
  return [];
}

/** Whether a timeline is within the limits. */
export function fits(doc) {
  return doc.items.length <= LIMITS.items && doc.lanes.length <= LIMITS.lanes && JSON.stringify(doc).length <= LIMITS.bytes;
}
