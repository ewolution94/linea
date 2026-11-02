/**
 * One open timeline, live: what the server has confirmed, the changes of this page on top of it, and
 * everyone else's as they arrive.
 *
 * A change shows at once (it's applied over the confirmed timeline), goes to the server in order, one
 * request at a time, and comes back on the stream with its number; then it's part of the confirmed
 * timeline. Others' changes arrive the same way. The stream is the family's live connection
 * (plans/live-connection.md): a named heartbeat every 20 s, reconnects with backoff, a 45 s watchdog,
 * and a wake on `online` and on coming back to the tab. A page that reconnects gets what it missed.
 *
 * Undo and redo are this page's own changes only: each change keeps the operations that put back what
 * it changed.
 */

import { apply, cleanOp, inverse, LIMITS, type Doc, type Op } from '../../shared/model.mjs';
import { keepCopy, loadCopy, recent, rekeyed, remember, viewOf } from './recent.svelte.ts';
import { prefs } from './prefs.svelte.ts';

export type Role = 'edit' | 'view';
export interface Person {
  cid: string;
  name: string;
  role: Role;
  hold: string | null;
}
export type Status = 'loading' | 'ready' | 'missing' | 'gone' | 'unreachable';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** A random id: lanes, items, batches (never a link's key, which the server makes). */
export const newId = (n = 12) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => B64[x & 63]).join('');

/** This tab, for the server: its own changes come back marked with it. */
export const CID = newId(16);

const STALE = 45_000;
const UNDO_STEPS = 100;
const EMPTY: Doc = { name: '', lanes: [], items: [] };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Pending {
  b: string;
  ops: Op[];
  /** Its number, once the server has answered. */
  seq?: number;
}

export class Board {
  key: string;
  role = $state<Role>('view');
  status = $state<Status>('loading');
  /** Showing this device's last copy while there's no connection: read only. */
  offline = $state(false);
  conn = $state<'connecting' | 'online' | 'reconnecting'>('connecting');
  doc = $state.raw<Doc>(EMPTY);
  people = $state.raw<Person[]>([]);
  editKey = $state<string | null>(null);
  viewKey = $state('');
  canUndo = $state(false);
  canRedo = $state(false);
  /** A change the server turned down: 'full' or 'rejected'. */
  problem = $state<'full' | 'rejected' | null>(null);

  readOnly = $derived(this.role !== 'edit' || this.offline);

  #confirmed: Doc = EMPTY;
  #seq = 0;
  #pending: Pending[] = [];
  #sending = false;
  #undo: Op[][] = [];
  #redo: Op[][] = [];
  #es: EventSource | null = null;
  #tries = 0;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #last = 0;
  #closed = false;
  #rekeying = false;
  #saveTimer: ReturnType<typeof setTimeout> | undefined;
  #off: (() => void)[] = [];

  constructor(key: string, role: Role) {
    this.key = key;
    this.role = role;
  }

  async open() {
    const watchdog = setInterval(() => {
      if (this.#es && Date.now() - this.#last > STALE) this.#reconnect(0);
    }, 10_000);
    const wake = () => {
      if (document.visibilityState === 'hidden' || this.#closed) return;
      if (this.status === 'unreachable') void this.#load();
      else if (this.status === 'ready' && (!this.#es || Date.now() - this.#last > STALE)) this.#reconnect(0);
    };
    addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    this.#off.push(
      () => clearInterval(watchdog),
      () => removeEventListener('online', wake),
      () => document.removeEventListener('visibilitychange', wake),
    );
    await this.#load();
  }

  close() {
    this.#closed = true;
    this.#es?.close();
    this.#es = null;
    clearTimeout(this.#retry);
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#keep();
    }
    for (const off of this.#off) off();
  }

  async #load() {
    try {
      const res = await fetch(`/api/t/${this.key}`, { cache: 'no-store' });
      if (res.status === 404) {
        this.status = 'missing';
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { doc: Doc; seq: number; role: Role; edit?: string; view: string };
      if (this.#closed) return;
      this.role = body.role;
      this.editKey = body.edit ?? null;
      this.viewKey = body.view;
      this.#confirmed = body.doc;
      this.#seq = body.seq;
      this.offline = false;
      this.#recompute();
      this.status = 'ready';
      this.#keep();
      this.#connect();
    } catch {
      if (this.#closed) return;
      // No connection: this device's last copy, read only, until the stream gets through.
      const view = viewOf(this.key);
      const copy = view ? loadCopy(view) : null;
      if (copy && this.status !== 'ready') {
        const entry = recent.list.find((r) => r.view === view);
        this.viewKey = view!;
        this.editKey = entry?.edit ?? null;
        this.role = entry?.edit === this.key ? 'edit' : 'view';
        this.#confirmed = copy.doc;
        this.#seq = copy.seq;
        this.offline = true;
        this.#recompute();
        this.status = 'ready';
        this.#connect();
      } else if (this.status !== 'ready') {
        this.status = 'unreachable';
        clearTimeout(this.#retry);
        this.#retry = setTimeout(() => void this.#load(), 8000);
      }
    }
  }

  #connect() {
    if (this.#closed) return;
    this.#es?.close();
    const name = encodeURIComponent(prefs.name);
    const es = new EventSource(`/api/t/${this.key}/live?since=${this.#seq}&cid=${CID}&name=${name}`);
    this.#es = es;
    this.#last = Date.now();
    this.conn = this.#tries ? 'reconnecting' : 'connecting';
    const live = () => {
      this.#last = Date.now();
      if (this.conn !== 'online') this.conn = 'online';
      this.#tries = 0;
      // Opened from the last copy: the stream catches it up from that copy's number.
      if (this.offline) this.offline = false;
    };
    es.addEventListener('open', live);
    es.addEventListener('ping', live);
    es.addEventListener('ops', (e) => {
      live();
      this.#batch(JSON.parse((e as MessageEvent).data));
    });
    es.addEventListener('snapshot', (e) => {
      live();
      const { doc, seq } = JSON.parse((e as MessageEvent).data) as { doc: Doc; seq: number };
      this.#confirmed = doc;
      this.#seq = seq;
      this.#pending = this.#pending.filter((p) => p.seq === undefined || p.seq > seq);
      this.#recompute();
      this.#keepSoon();
    });
    es.addEventListener('who', (e) => {
      live();
      this.people = JSON.parse((e as MessageEvent).data);
    });
    es.addEventListener('gone', () => {
      if (this.#rekeying) return;
      this.status = 'gone';
      this.close();
    });
    es.onerror = () => {
      if (this.#es !== es) return;
      es.close();
      this.#es = null;
      if (this.#closed) return;
      this.conn = 'reconnecting';
      this.#tries++;
      // Once in a while, ask whether the link still opens anything (new links, a typo).
      if (this.#tries % 3 === 0) {
        void fetch(`/api/t/${this.key}`, { cache: 'no-store' })
          .then((res) => {
            if (res.status === 404 && !this.#rekeying) {
              this.status = 'gone';
              this.close();
            }
          })
          .catch(() => {});
      }
      this.#reconnect(Math.min(15_000, 1000 * 2 ** Math.min(this.#tries - 1, 4)));
    };
  }

  #reconnect(delay: number) {
    clearTimeout(this.#retry);
    this.#retry = setTimeout(() => this.#connect(), delay);
  }

  #batch(batch: { seq: number; cid: string; b: string; ops: Op[] }) {
    if (batch.seq <= this.#seq) return;
    if (batch.seq !== this.#seq + 1) {
      // A gap: start over from the last number this page has.
      this.#reconnect(0);
      return;
    }
    for (const op of batch.ops) apply(this.#confirmed, op);
    this.#seq = batch.seq;
    if (batch.cid === CID) this.#pending = this.#pending.filter((p) => p.b !== batch.b);
    this.offline = false;
    this.#recompute();
    this.#keepSoon();
  }

  #recompute() {
    const doc = structuredClone(this.#confirmed);
    for (const p of this.#pending) for (const op of p.ops) apply(doc, op);
    this.doc = doc;
  }

  /** The last copy on this device, and the name on the home's list. */
  #keep() {
    this.#saveTimer = undefined;
    if (!this.viewKey) return;
    remember({ view: this.viewKey, edit: this.editKey ?? undefined, name: this.#confirmed.name });
    keepCopy(this.viewKey, this.#confirmed, this.#seq);
  }

  #keepSoon() {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.#keep(), 1500);
  }

  /** A change of this page: shown at once, sent in order. */
  change(ops: Op[], { record = true } = {}) {
    if (this.readOnly) return;
    const clean = ops.map((op) => cleanOp(op)).filter((op): op is Op => !!op);
    if (!clean.length) return;
    if (record) {
      const back = inverse(this.doc, clean);
      if (back.length) {
        this.#undo.push(back);
        if (this.#undo.length > UNDO_STEPS) this.#undo.shift();
        this.#redo = [];
      }
    }
    this.problem = null;
    this.#pending.push({ b: newId(10), ops: clean });
    this.#recompute();
    this.#counts();
    void this.#flush();
  }

  undo() {
    const back = this.#undo.pop();
    if (!back || this.readOnly) return;
    this.#redo.push(inverse(this.doc, back));
    this.change(back, { record: false });
  }

  redo() {
    const again = this.#redo.pop();
    if (!again || this.readOnly) return;
    this.#undo.push(inverse(this.doc, again));
    this.change(again, { record: false });
  }

  #counts() {
    this.canUndo = this.#undo.length > 0;
    this.canRedo = this.#redo.length > 0;
  }

  async #flush() {
    if (this.#sending) return;
    this.#sending = true;
    let delay = 1000;
    while (!this.#closed) {
      const next = this.#pending.find((p) => p.seq === undefined);
      if (!next) break;
      try {
        const res = await fetch(`/api/t/${this.key}/ops`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cid: CID, b: next.b, ops: next.ops }),
        });
        if (res.ok) {
          next.seq = ((await res.json()) as { seq: number }).seq;
          // Its echo may have come in already, as part of a whole timeline.
          if (next.seq <= this.#seq) this.#pending = this.#pending.filter((p) => p !== next);
          delay = 1000;
          continue;
        }
        if (res.status === 404 || res.status === 403) {
          this.#pending = [];
          this.#recompute();
          if (res.status === 404 && !this.#rekeying) this.status = 'gone';
          break;
        }
        if (res.status === 400 || res.status === 413) {
          // Turned down for good (the timeline is full): it's taken back here too.
          this.#pending = this.#pending.filter((p) => p !== next);
          this.#recompute();
          this.problem = res.status === 413 ? 'full' : 'rejected';
          continue;
        }
        throw new Error(String(res.status));
      } catch {
        await wait(delay);
        delay = Math.min(10_000, delay * 2);
      }
    }
    this.#sending = false;
  }

  /** Who's moving what, for the others' pages. */
  hold(id: string | null) {
    if (this.role !== 'edit' || this.offline) return;
    void fetch(`/api/t/${this.key}/presence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cid: CID, hold: id }),
    }).catch(() => {});
  }

  /** A new name for this page in the others' lists. */
  rename(name: string) {
    if (this.role !== 'edit' || this.offline) return;
    void fetch(`/api/t/${this.key}/presence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cid: CID, name }),
    }).catch(() => {});
  }

  /** New links for this timeline; the old ones stop working. */
  async rekey(): Promise<{ edit: string; view: string } | null> {
    if (this.role !== 'edit') return null;
    this.#rekeying = true;
    try {
      const res = await fetch(`/api/t/${this.key}/rekey`, { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      const keys = (await res.json()) as { edit: string; view: string };
      rekeyed(this.viewKey, keys);
      return keys;
    } catch {
      this.#rekeying = false;
      return null;
    }
  }
}

export const isFull = (doc: Doc) => doc.items.length >= LIMITS.items;
