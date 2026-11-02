// The timelines on disk: one SQLite file on the stack's /data volume (node:sqlite, no dependency).
//
// One row per timeline with its two keys, the timeline as JSON and the number of its last operation,
// plus the recent operations, so a page that reconnects catches up with what it missed instead of
// loading the whole timeline again.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/** Operations kept per timeline for catching up; a page further behind gets the whole timeline. */
export const KEEP_OPS = 500;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS timelines (
    id INTEGER PRIMARY KEY,
    edit TEXT NOT NULL UNIQUE,
    view TEXT NOT NULL UNIQUE,
    doc TEXT NOT NULL,
    seq INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ops (
    timeline INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    cid TEXT NOT NULL,
    batch TEXT NOT NULL,
    ops TEXT NOT NULL,
    PRIMARY KEY (timeline, seq)
  ) WITHOUT ROWID;
`;

export function openStore(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);

  const q = {
    byEdit: db.prepare('SELECT id, edit, view, doc, seq FROM timelines WHERE edit = ?'),
    byView: db.prepare('SELECT id, edit, view, doc, seq FROM timelines WHERE view = ?'),
    byId: db.prepare('SELECT id, edit, view, doc, seq FROM timelines WHERE id = ?'),
    insert: db.prepare('INSERT INTO timelines (edit, view, doc, seq, created, updated) VALUES (?, ?, ?, 0, ?, ?)'),
    save: db.prepare('UPDATE timelines SET doc = ?, seq = ?, updated = ? WHERE id = ?'),
    rekey: db.prepare('UPDATE timelines SET edit = ?, view = ? WHERE id = ?'),
    addOps: db.prepare('INSERT INTO ops (timeline, seq, cid, batch, ops) VALUES (?, ?, ?, ?, ?)'),
    since: db.prepare('SELECT seq, cid, batch, ops FROM ops WHERE timeline = ? AND seq > ? ORDER BY seq'),
    oldest: db.prepare('SELECT MIN(seq) AS seq FROM ops WHERE timeline = ?'),
    prune: db.prepare('DELETE FROM ops WHERE timeline = ? AND seq <= ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM timelines'),
  };

  const row = (r) => (r ? { id: r.id, edit: r.edit, view: r.view, doc: JSON.parse(r.doc), seq: r.seq } : null);

  return {
    /** A timeline by either key, with the role that key gives. */
    find(key) {
      const edit = q.byEdit.get(key);
      if (edit) return { ...row(edit), role: 'edit' };
      const view = q.byView.get(key);
      return view ? { ...row(view), role: 'view' } : null;
    },
    get: (id) => row(q.byId.get(id)),
    create(edit, view, doc) {
      const now = Date.now();
      const { lastInsertRowid } = q.insert.run(edit, view, JSON.stringify(doc), now, now);
      return Number(lastInsertRowid);
    },
    /** Saves a batch: the timeline as it now is, and its operations under their number. */
    save(id, doc, seq, cid, batch, ops) {
      db.exec('BEGIN');
      try {
        q.save.run(JSON.stringify(doc), seq, Date.now(), id);
        q.addOps.run(id, seq, cid, batch, JSON.stringify(ops));
        if (seq % 50 === 0) q.prune.run(id, seq - KEEP_OPS);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    /** The batches after `seq`, or null if some of them are no longer kept. */
    since(id, seq) {
      const oldest = q.oldest.get(id)?.seq;
      const rows = q.since.all(id, seq);
      if (rows.length && rows[0].seq !== seq + 1) return null;
      if (!rows.length && oldest != null && oldest > seq + 1) return null;
      return rows.map((r) => ({ seq: r.seq, cid: r.cid, b: r.batch, ops: JSON.parse(r.ops) }));
    },
    rekey: (id, edit, view) => q.rekey.run(edit, view, id),
    count: () => q.count.get().n,
    close: () => db.close(),
  };
}
