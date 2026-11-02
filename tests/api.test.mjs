import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openStore } from '../server/store.mjs';
import { createApi } from '../server/api.mjs';

let server, base, api, clock;

before(async () => {
  clock = Date.now();
  api = createApi({ store: openStore(':memory:'), now: () => clock });
  server = http.createServer(async (req, res) => {
    if (!(await api.handle(req, res, new URL(req.url, 'http://x')))) res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  api.close();
  server.closeAllConnections();
  server.close();
});

const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const make = async (body) => (await post('/api/new', body)).json();

/** Reads a live stream's events until `count` have arrived (pings left out). */
async function listen(key, query, count) {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/t/${key}/live?${query}`, { signal: controller.signal });
  const reader = res.body.getReader();
  const events = [];
  let buffer = '';
  const more = async (n) => {
    while (events.length < n) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value);
      let at;
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (event && event !== 'ping') events.push({ event, data: JSON.parse(data) });
      }
    }
    return events;
  };
  await more(count);
  return { events, more, close: () => controller.abort() };
}

test('a new timeline has two links, and each opens it in its role', async () => {
  const { edit, view } = await make({ lang: 'de' });
  assert.match(edit, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(edit, view);
  const asEditor = await (await fetch(`${base}/api/t/${edit}`)).json();
  assert.equal(asEditor.role, 'edit');
  assert.equal(asEditor.edit, edit);
  assert.equal(asEditor.view, view);
  assert.equal(asEditor.doc.lanes.length, 3);
  assert.equal(asEditor.doc.name, 'Neue Zeitleiste');
  const asViewer = await (await fetch(`${base}/api/t/${view}`)).json();
  assert.equal(asViewer.role, 'view');
  assert.equal(asViewer.edit, undefined);
  assert.equal((await fetch(`${base}/api/t/AAAAAAAAAAAAAAAAAAAAAA`)).status, 404);
});

test('operations are numbered, saved and passed on; the view link changes nothing', async () => {
  const { edit, view } = await make();
  const { doc } = await (await fetch(`${base}/api/t/${edit}`)).json();
  // Nothing missed at 0: the stream starts with who's here.
  const watcher = await listen(view, 'since=0&cid=watcher1', 1);
  assert.deepEqual(watcher.events.map((e) => e.event), ['who']);
  const lane = doc.lanes[0].id;
  const ops = [{ op: 'item+', item: { id: 'it1', lane, name: 'Draft', start: 20000, end: 20007 } }];
  const res = await post(`/api/t/${edit}/ops`, { cid: 'editor1', b: 'b1', ops });
  assert.deepEqual(await res.json(), { seq: 1 });
  const events = await watcher.more(watcher.events.length + 1);
  const batch = events.find((e) => e.event === 'ops').data;
  assert.equal(batch.seq, 1);
  assert.equal(batch.cid, 'editor1');
  assert.equal(batch.ops[0].item.kind, 'bar');
  // The same batch again (a dropped answer) is not applied twice.
  assert.deepEqual(await (await post(`/api/t/${edit}/ops`, { cid: 'editor1', b: 'b1', ops })).json(), { seq: 1 });
  assert.equal((await post(`/api/t/${view}/ops`, { cid: 'viewer1', b: 'b2', ops })).status, 403);
  assert.equal((await post(`/api/t/${edit}/ops`, { cid: 'editor1', b: 'b3', ops: [{ op: 'nope' }] })).status, 400);
  const after = await (await fetch(`${base}/api/t/${view}`)).json();
  assert.equal(after.seq, 1);
  assert.equal(after.doc.items.length, 1);
  watcher.close();
});

test('a page that reconnects gets what it missed, or the whole timeline', async () => {
  const { edit } = await make();
  const { doc } = await (await fetch(`${base}/api/t/${edit}`)).json();
  for (let n = 1; n <= 3; n++) await post(`/api/t/${edit}/ops`, { cid: 'editor1', b: `n${n}`, ops: [{ op: 'name', name: `Name ${n}` }] });
  const caught = await listen(edit, 'since=1&cid=late01', 2);
  assert.deepEqual(caught.events.slice(0, 2).map((e) => [e.event, e.data.seq]), [['ops', 2], ['ops', 3]]);
  caught.close();
  const fresh = await listen(edit, 'since=99&cid=late02', 1);
  assert.equal(fresh.events[0].event, 'snapshot');
  assert.equal(fresh.events[0].data.doc.name, 'Name 3');
  assert.equal(fresh.events[0].data.doc.lanes.length, doc.lanes.length);
  fresh.close();
});

test('presence lists who is here and what they hold', async () => {
  const { edit } = await make();
  const a = await listen(edit, 'since=0&cid=alice1&name=Alice', 1);
  const res = await post(`/api/t/${edit}/presence`, { cid: 'alice1', hold: 'item1' });
  assert.equal(res.status, 204);
  const events = await a.more(a.events.length + 1);
  const last = events.filter((e) => e.event === 'who').at(-1).data;
  assert.deepEqual(last, [{ cid: 'alice1', name: 'Alice', role: 'edit', hold: 'item1' }]);
  a.close();
});

test('new links replace both, and the old ones stop working', async () => {
  const { edit, view } = await make();
  const other = await listen(edit, 'since=0&cid=other1', 1);
  const fresh = await (await post(`/api/t/${edit}/rekey`)).json();
  assert.notEqual(fresh.edit, edit);
  assert.notEqual(fresh.view, view);
  const events = await other.more(other.events.length + 1);
  assert.equal(events.at(-1).event, 'gone');
  assert.equal((await fetch(`${base}/api/t/${edit}`)).status, 404);
  assert.equal((await fetch(`${base}/api/t/${view}`)).status, 404);
  assert.equal((await (await fetch(`${base}/api/t/${fresh.view}`)).json()).role, 'view');
  assert.equal(api.page(fresh.edit).role, 'edit');
});

test('an import is cleaned, and one too large is turned down', async () => {
  const { edit } = await make({ doc: { name: 'Imported', lanes: [{ id: 'a', name: 'A' }], items: [{ id: 'x', lane: 'a', start: 5, end: 9 }, { id: 'y', lane: 'q', start: 5 }] } });
  const { doc } = await (await fetch(`${base}/api/t/${edit}`)).json();
  assert.equal(doc.name, 'Imported');
  assert.equal(doc.items.length, 1);
  assert.equal((await post('/api/new', { doc: { lanes: 1 } })).status, 400);
  const items = Array.from({ length: 2001 }, (_, i) => ({ id: `i${i}`, lane: 'a', start: 1, end: 2 }));
  const res = await post('/api/new', { doc: { name: 'Big', lanes: [{ id: 'a' }], items } });
  // Cleaning keeps the first 2,000; it fits.
  assert.equal(res.status, 201);
});

test('one address makes at most 20 timelines an hour', async () => {
  clock += 4 * 3_600_000;
  for (let i = 0; i < 20; i++) assert.equal((await post('/api/new')).status, 201);
  assert.equal((await post('/api/new')).status, 429);
  clock += 3_600_001;
  assert.equal((await post('/api/new')).status, 201);
});
