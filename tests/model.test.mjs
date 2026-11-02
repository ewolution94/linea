import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, cleanDoc, cleanOp, fits, inverse, LIMITS } from '../shared/model.mjs';

const doc = () => ({
  name: 'Plan',
  lanes: [
    { id: 'a', name: 'Design', colour: 0 },
    { id: 'b', name: 'Build', colour: 1 },
  ],
  items: [
    { id: 'i1', lane: 'a', name: 'Wireframes', start: 100, end: 110, kind: 'bar', colour: null, note: '' },
    { id: 'i2', lane: 'b', name: 'Go live', start: 120, end: 121, kind: 'ms', colour: null, note: '' },
  ],
});

const run = (d, ...ops) => {
  for (const op of ops) apply(d, cleanOp(op));
  return d;
};

test('operations are checked before they are applied', () => {
  assert.equal(cleanOp({ op: 'item', id: 'i1', set: { start: -1 } }), null);
  assert.equal(cleanOp({ op: 'item', id: 'i1', set: { colour: 9 } }), null);
  assert.equal(cleanOp({ op: 'item', id: 'bad id!', set: { name: 'x' } }), null);
  assert.equal(cleanOp({ op: 'drop table' }), null);
  assert.deepEqual(cleanOp({ op: 'item', id: 'i1', set: { colour: null, extra: 1 } }), { op: 'item', id: 'i1', set: { colour: null } });
  assert.equal(cleanOp({ op: 'name', name: ' A\n  plan ' }).name, 'A plan');
  assert.equal(cleanOp({ op: 'name', name: 'x'.repeat(500) }).name.length, LIMITS.name);
});

test('moving, stretching and renaming change only their fields', () => {
  const d = run(doc(), { op: 'item', id: 'i1', set: { start: 102, end: 112, lane: 'b' } }, { op: 'item', id: 'i1', set: { name: 'Flows' } });
  assert.deepEqual(d.items[0], { id: 'i1', lane: 'b', name: 'Flows', start: 102, end: 112, kind: 'bar', colour: null, note: '' });
});

test('the last write wins per field', () => {
  const d = run(doc(), { op: 'item', id: 'i1', set: { start: 101 } }, { op: 'item', id: 'i1', set: { name: 'A' } }, { op: 'item', id: 'i1', set: { start: 105 } });
  assert.equal(d.items[0].start, 105);
  assert.equal(d.items[0].name, 'A');
});

test('two ends stretched past each other keep at least a day', () => {
  const d = run(doc(), { op: 'item', id: 'i1', set: { start: 115 } });
  assert.ok(d.items[0].end > d.items[0].start);
});

test('an operation on something deleted meanwhile changes nothing', () => {
  const d = doc();
  apply(d, cleanOp({ op: 'item-', id: 'i1' }));
  assert.equal(apply(d, cleanOp({ op: 'item', id: 'i1', set: { start: 1 } })), false);
  assert.equal(apply(d, cleanOp({ op: 'item', id: 'i2', set: { lane: 'gone' } })), false);
  assert.equal(d.items[0].lane, 'b');
});

test('deleting a lane takes its items, and undo brings both back in place', () => {
  const before = doc();
  const ops = [cleanOp({ op: 'lane-', id: 'a' })];
  const back = inverse(before, ops);
  const d = structuredClone(before);
  for (const op of ops) apply(d, op);
  assert.deepEqual(d.lanes.map((l) => l.id), ['b']);
  assert.deepEqual(d.items.map((i) => i.id), ['i2']);
  for (const op of back) apply(d, cleanOp(op));
  assert.deepEqual(d.lanes, before.lanes);
  assert.deepEqual(new Set(d.items.map((i) => i.id)), new Set(['i1', 'i2']));
});

test('undo restores every kind of change', () => {
  const before = doc();
  const ops = [
    { op: 'name', name: 'Other' },
    { op: 'lane', id: 'b', set: { name: 'Ship', colour: 3 } },
    { op: 'order', ids: ['b', 'a'] },
    { op: 'item+', item: { id: 'n1', lane: 'a', name: 'New', start: 5, end: 9 } },
    { op: 'item', id: 'i1', set: { kind: 'ms', colour: 2 } },
    { op: 'item-', id: 'i2' },
  ].map(cleanOp);
  const back = inverse(before, ops);
  const d = structuredClone(before);
  for (const op of ops) apply(d, op);
  for (const op of back) apply(d, cleanOp(op));
  assert.deepEqual({ ...d, items: [...d.items].sort((x, y) => x.id.localeCompare(y.id)) }, before);
});

test('a lane order that misses a new lane keeps it at the end', () => {
  const d = run(doc(), { op: 'lane+', lane: { id: 'c', name: 'Launch', colour: 2 } }, { op: 'order', ids: ['b', 'a'] });
  assert.deepEqual(d.lanes.map((l) => l.id), ['b', 'a', 'c']);
});

test('an import is cleaned: unknown lanes, duplicate ids and bad days are dropped', () => {
  const d = cleanDoc({
    name: 'Import',
    lanes: [{ id: 'a', name: 'One' }, { id: 'a', name: 'Twice' }, { id: '??' }],
    items: [
      { id: 'x', lane: 'a', name: 'Fine', start: 3, end: 1 },
      { id: 'x', lane: 'a', start: 4 },
      { id: 'y', lane: 'z', start: 4 },
      { id: 'w', lane: 'a', start: 'soon' },
    ],
    extra: '<script>',
  });
  assert.deepEqual(d, { name: 'Import', lanes: [{ id: 'a', name: 'One', colour: 0 }], items: [{ id: 'x', lane: 'a', name: 'Fine', start: 3, end: 4, kind: 'bar', colour: null, note: '' }] });
  assert.equal(cleanDoc({ lanes: 'no' }), null);
});

test('a timeline beyond the limits does not fit', () => {
  const d = doc();
  for (let i = 0; i < LIMITS.items; i++) d.items.push({ id: `n${i}`, lane: 'a', name: '', start: 1, end: 2, kind: 'bar', colour: null, note: '' });
  assert.equal(fits(d), false);
});
