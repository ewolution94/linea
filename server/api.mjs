// The timelines' API: making one, loading it by either link, the live stream, operations, presence
// and new links. Every route is under /api/.
//
//   POST /api/new                    { doc? }            → { edit, view }   (a blank one, or an import)
//   GET  /api/t/<key>                                    → { doc, seq, role, edit?, view }
//   GET  /api/t/<key>/live?since=&cid=&name=             server-sent events: ops, snapshot, who, gone
//   POST /api/t/<key>/ops            { cid, b, ops }     → { seq }          (edit link only)
//   POST /api/t/<key>/presence       { cid, name, hold } → 204              (edit link only)
//   POST /api/t/<key>/rekey                              → { edit, view }   (edit link only)
//
// The link is the key: 128 random bits each (learnings/randomness.md), and the view key can't be
// turned into the edit key. Each open timeline lives in memory while someone has it open (its
// streams, who's here), and every batch is saved before it's passed on.

import { randomBytes } from 'node:crypto';
import { apply, cleanDoc, cleanOp, fits, LIMITS } from '../shared/model.mjs';

const HEARTBEAT = 20_000;
const BODY_LIMIT = 1_200_000;
/** New timelines per address per hour. */
const NEW_PER_HOUR = 20;
const KEY = /^[A-Za-z0-9_-]{22}$/;
const CID = /^[A-Za-z0-9_-]{6,32}$/;

export const newKey = () => randomBytes(16).toString('base64url');

/** A blank timeline: three empty lanes. */
export function blank(lang = 'en') {
  const names = lang === 'de' ? ['Planung', 'Umsetzung', 'Start'] : ['Planning', 'Work', 'Launch'];
  return {
    name: lang === 'de' ? 'Neue Zeitleiste' : 'New timeline',
    lanes: names.map((name, i) => ({ id: randomBytes(6).toString('base64url'), name, colour: i })),
    items: [],
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'not JSON');
  }
}

function json(res, status, body) {
  const raw = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': raw.length });
  res.end(raw);
}

export function createApi({ store, now = Date.now }) {
  /** Open timelines by their row id: { id, doc, seq, keys, streams, recent }. */
  const rooms = new Map();
  /** New timelines per address in the last hour; the addresses stay here and nowhere else. */
  const made = new Map();

  function room(id) {
    let r = rooms.get(id);
    if (r) return r;
    const row = store.get(id);
    if (!row) return null;
    r = { id, doc: row.doc, seq: row.seq, edit: row.edit, view: row.view, streams: new Set(), recent: new Map() };
    rooms.set(id, r);
    return r;
  }

  function resolve(key) {
    if (!KEY.test(key)) return null;
    for (const r of rooms.values()) {
      if (r.edit === key) return { room: r, role: 'edit' };
      if (r.view === key) return { room: r, role: 'view' };
    }
    const found = store.find(key);
    return found ? { room: room(found.id), role: found.role } : null;
  }

  function send(stream, event, data) {
    stream.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function who(r) {
    return [...r.streams].map((s) => ({ cid: s.cid, name: s.name, role: s.role, hold: s.hold }));
  }

  function broadcastWho(r) {
    const list = who(r);
    for (const s of r.streams) send(s, 'who', list);
  }

  /** Drops a room from memory once nobody has it open. */
  function release(r) {
    if (!r.streams.size) rooms.delete(r.id);
  }

  function rateOk(address) {
    const hour = now() - 3_600_000;
    const times = (made.get(address) ?? []).filter((t) => t > hour);
    if (times.length >= NEW_PER_HOUR) return false;
    times.push(now());
    made.set(address, times);
    if (made.size > 5000) for (const [a, list] of made) if (!list.some((t) => t > hour)) made.delete(a);
    return true;
  }

  async function create(req, res) {
    const body = await readJson(req, BODY_LIMIT);
    const address = req.socket.remoteAddress ?? '';
    if (!rateOk(address)) throw new HttpError(429, 'too many new timelines');
    const lang = body.lang === 'de' ? 'de' : 'en';
    let doc = blank(lang);
    if (body.doc !== undefined) {
      doc = cleanDoc(body.doc);
      if (!doc) throw new HttpError(400, 'not a timeline');
      if (!fits(doc)) throw new HttpError(413, 'too large');
    }
    const edit = newKey();
    const view = newKey();
    store.create(edit, view, doc);
    json(res, 201, { edit, view });
  }

  function load(res, found) {
    const { room: r, role } = found;
    const body = { doc: r.doc, seq: r.seq, role, view: r.view };
    if (role === 'edit') body.edit = r.edit;
    json(res, 200, body);
  }

  function live(req, res, found, url) {
    const { room: r, role } = found;
    const cid = url.searchParams.get('cid') ?? '';
    if (!CID.test(cid)) throw new HttpError(400, 'cid');
    const name = (url.searchParams.get('name') ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const since = Number(url.searchParams.get('since'));

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 4000\n\n');
    const stream = { res, cid, name, role, hold: null, key: role === 'edit' ? r.edit : r.view };
    r.streams.add(stream);

    // What it missed: the batches since its number, or the whole timeline if they're no longer kept.
    const missed = Number.isInteger(since) && since >= 0 && since <= r.seq ? store.since(r.id, since) : null;
    if (missed) for (const batch of missed) send(stream, 'ops', batch);
    else send(stream, 'snapshot', { doc: r.doc, seq: r.seq });
    broadcastWho(r);

    const beat = setInterval(() => res.write('event: ping\ndata: 1\n\n'), HEARTBEAT);
    beat.unref?.();
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      clearInterval(beat);
      r.streams.delete(stream);
      broadcastWho(r);
      release(r);
    };
    req.on('close', close);
    res.on('error', close);
  }

  async function ops(req, res, found) {
    const { room: r, role } = found;
    if (role !== 'edit') throw new HttpError(403, 'view link');
    const body = await readJson(req, BODY_LIMIT);
    if (!CID.test(body.cid ?? '') || typeof body.b !== 'string' || body.b.length > 32 || !Array.isArray(body.ops)) throw new HttpError(400, 'batch');
    if (body.ops.length > LIMITS.batch) throw new HttpError(413, 'too many operations');
    // A batch sent again after a dropped answer is answered with its number, not applied twice.
    const seen = r.recent.get(`${body.cid}:${body.b}`);
    if (seen) return json(res, 200, { seq: seen });

    const clean = body.ops.map(cleanOp);
    if (clean.some((op) => !op)) throw new HttpError(400, 'operation');
    const next = structuredClone(r.doc);
    for (const op of clean) apply(next, op);
    if (!fits(next)) throw new HttpError(413, 'the timeline is full');

    const seq = r.seq + 1;
    store.save(r.id, next, seq, body.cid, body.b, clean);
    r.doc = next;
    r.seq = seq;
    r.recent.set(`${body.cid}:${body.b}`, seq);
    if (r.recent.size > 400) r.recent.delete(r.recent.keys().next().value);
    const batch = { seq, cid: body.cid, b: body.b, ops: clean };
    for (const s of r.streams) send(s, 'ops', batch);
    json(res, 200, { seq });
  }

  async function presence(req, res, found) {
    const { room: r, role } = found;
    if (role !== 'edit') throw new HttpError(403, 'view link');
    const body = await readJson(req, 4096);
    const mine = [...r.streams].filter((s) => s.cid === body.cid);
    for (const s of mine) {
      if (typeof body.name === 'string') s.name = body.name.replace(/\s+/g, ' ').trim().slice(0, 40);
      if ('hold' in body) s.hold = typeof body.hold === 'string' && body.hold.length <= 24 ? body.hold : null;
    }
    if (mine.length) broadcastWho(r);
    res.writeHead(204).end();
  }

  function rekey(res, found) {
    const { room: r, role } = found;
    if (role !== 'edit') throw new HttpError(403, 'view link');
    r.edit = newKey();
    r.view = newKey();
    store.rekey(r.id, r.edit, r.view);
    // Everyone on the old links is let go; the page that asked opens the new edit link.
    for (const s of r.streams) {
      send(s, 'gone', {});
      s.res.end();
    }
    r.streams.clear();
    json(res, 200, { edit: r.edit, view: r.view });
  }

  /** Answers an /api/ request; false if the path isn't one. */
  return {
    async handle(req, res, url) {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] !== 'api') return false;
      res.setHeader('x-robots-tag', 'noindex');
      let found = null;
      try {
        if (parts.length === 2 && parts[1] === 'new' && req.method === 'POST') {
          await create(req, res);
          return true;
        }
        if (parts[1] !== 't' || parts.length < 3 || parts.length > 4) throw new HttpError(404, 'not found');
        found = resolve(parts[2]);
        if (!found) throw new HttpError(404, 'no timeline');
        const action = parts[3] ?? '';
        const method = req.method;
        if (action === '' && method === 'GET') load(res, found);
        else if (action === 'live' && method === 'GET') live(req, res, found, url);
        else if (action === 'ops' && method === 'POST') await ops(req, res, found);
        else if (action === 'presence' && method === 'POST') await presence(req, res, found);
        else if (action === 'rekey' && method === 'POST') rekey(res, found);
        else throw new HttpError(action ? 405 : 404, 'not here');
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        if (!res.headersSent) json(res, error.status, { error: error.message });
      } finally {
        // A stream keeps its room in memory; anything else lets it go.
        if (found) release(found.room);
      }
      return true;
    },
    /** A timeline's name and role for its page (title and link preview), or null. */
    page(key) {
      const found = resolve(key);
      if (!found) return null;
      const result = { name: found.room.doc.name, role: found.role };
      release(found.room);
      return result;
    },
    /** Ends every stream, for a clean shutdown. */
    close() {
      for (const r of rooms.values()) for (const s of r.streams) s.res.end();
    },
  };
}
