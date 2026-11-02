// Linea end to end, in a real browser against the production server: a fresh build, its CSP, and a data
// folder of its own that goes away afterwards.
//
//   node tests/e2e/run.mjs [--no-build] [--headed] [--port N] [--grep words]
//
// Every test runs in a fresh browser context and fails, on top of its own asserts, when the page logs an
// error or asks anything of another origin. The phone's press-and-hold goes through real touch events
// (Chromium's DevTools protocol), since Playwright's touchscreen only taps.
// Locally only: CI runs the unit tests and the server's smoke test.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : fallback;
};
const port = Number(option('--port', 7514));
const grep = option('--grep', '');
const base = `http://localhost:${port}`;

if (!flag('--no-build')) {
  const { build } = await import('vite');
  await build({ root, logLevel: 'warn' });
}
const data = await mkdtemp(path.join(os.tmpdir(), 'linea-e2e-'));
const child = spawn(process.execPath, ['server/server.mjs', '--port', String(port)], {
  cwd: root,
  env: { ...process.env, LINEA_DATA: data },
  stdio: ['ignore', 'ignore', 'inherit'],
});
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${base}/healthz`)).ok) break;
  } catch {}
  if (i > 100) throw new Error('The server did not start');
  await new Promise((r) => setTimeout(r, 100));
}

const DESK = { viewport: { width: 1280, height: 800 } };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const today = () => Math.floor(Date.now() / 86_400_000);

const api = {
  async make(doc) {
    const res = await fetch(`${base}/api/new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc ? { doc } : { lang: 'en' }) });
    assert.equal(res.status, 201);
    return res.json();
  },
  async doc(key) {
    return (await (await fetch(`${base}/api/t/${key}`)).json()).doc;
  },
};

/** Waits until `check` returns something truthy (or throws its last error). */
async function until(check, what, ms = 4000) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    if (Date.now() > end) throw last ?? new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 60));
  }
}

const keyOf = (url) => /\/[ev]\/([\w-]{22})/.exec(url)?.[1];

/** A small plan: two lanes, one bar a week long starting today, and a milestone. */
function plan() {
  const t = today();
  return {
    name: 'E2E plan',
    lanes: [
      { id: 'laneA', name: 'Build', colour: 0 },
      { id: 'laneB', name: 'Ship', colour: 3 },
    ],
    items: [
      { id: 'barA', lane: 'laneA', name: 'Platform', start: t, end: t + 14, kind: 'bar', colour: null, note: '' },
      { id: 'msB', lane: 'laneB', name: 'Launch', start: t + 21, end: t + 28, kind: 'ms', colour: null, note: '' },
    ],
  };
}

/** Drags with the mouse in small steps, as a hand would. */
async function drag(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

const tests = {
  async 'a new timeline: draw a bar, name it, move it, stretch it, undo'(t) {
    const page = await t.page(DESK);
    await page.goto(base);
    await page.getByRole('button', { name: 'New timeline' }).click();
    await page.waitForURL(/\/e\//);
    const key = keyOf(page.url());
    const first = await api.doc(key);
    assert.equal(first.lanes.length, 3);
    assert.equal(first.items.length, 0);

    // Across the first lane, right of its head.
    const lane = await page.locator(`.ln[data-lane="${first.lanes[0].id}"]`).boundingBox();
    const y = lane.y + 28;
    await drag(page, { x: 520, y }, { x: 700, y });
    await page.locator('.it-in').waitFor();
    await page.keyboard.type('Design');
    await page.keyboard.press('Enter');
    const drawn = await until(async () => {
      const doc = await api.doc(key);
      return doc.items.length === 1 && doc.items[0].name === 'Design' && doc.items[0];
    }, 'the drawn bar');
    assert.equal(drawn.lane, first.lanes[0].id);
    assert.equal(drawn.kind, 'bar');
    assert.ok(drawn.end - drawn.start >= 10, `a bar over 180 px is ${drawn.end - drawn.start} days`);

    // Move it by its middle, then stretch it by its end stop.
    const bar = page.locator(`.it[data-id="${drawn.id}"]`);
    const at = centre(await bar.boundingBox());
    await drag(page, at, { x: at.x + 100, y: at.y });
    const moved = await until(async () => {
      const item = (await api.doc(key)).items[0];
      return item.start > drawn.start && item;
    }, 'the move');
    assert.equal(moved.end - moved.start, drawn.end - drawn.start, 'a move keeps the length');

    const stop = centre(await bar.locator('.he').boundingBox());
    await drag(page, stop, { x: stop.x + 80, y: stop.y });
    const stretched = await until(async () => {
      const item = (await api.doc(key)).items[0];
      return item.end > moved.end && item;
    }, 'the stretch');
    assert.equal(stretched.start, moved.start, 'a stretch keeps the start');

    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+z');
    await until(async () => (await api.doc(key)).items[0].end === moved.end, 'the undo');
  },

  async 'two pages on the edit link see each other, the view link only looks'(t) {
    const { edit, view } = await api.make(plan());
    const a = await t.page(DESK);
    const b = await t.page(DESK);
    await a.goto(`${base}/e/${edit}`);
    await b.goto(`${base}/e/${edit}`);
    await a.locator('.it[data-id="barA"]').waitFor();
    await b.locator('.it[data-id="barA"]').waitFor();

    // A renames the plan; B's title follows.
    const title = a.getByRole('textbox', { name: 'Timeline name' });
    await title.fill('Renamed live');
    await title.press('Enter');
    await until(async () => (await b.title()).startsWith('Renamed live'), 'the rename on the other page');

    // B moves the bar; A sees it move.
    const before = await a.locator('.it[data-id="barA"]').boundingBox();
    const at = centre(await b.locator('.it[data-id="barA"]').boundingBox());
    await drag(b, at, { x: at.x + 120, y: at.y });
    await until(async () => (await a.locator('.it[data-id="barA"]').boundingBox()).x > before.x + 60, 'the move on the other page');

    // The view link: everything to read, nothing to change.
    const v = await t.page(DESK);
    await v.goto(`${base}/v/${view}`);
    await v.locator('.it[data-id="barA"]').waitFor();
    assert.equal(await v.getByRole('textbox', { name: 'Timeline name' }).count(), 0);
    assert.equal(await v.locator('h1').textContent(), 'Renamed live');
    assert.equal(await v.locator('.lh .grip').count(), 0);
    const refused = await fetch(`${base}/api/t/${view}/ops`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cid: 'e2e', b: 1, ops: [{ op: 'name', name: 'nope' }] }),
    });
    assert.equal(refused.status, 403);
    // And it still follows the edits.
    await title.fill('Renamed again');
    await title.press('Enter');
    await until(async () => (await v.locator('h1').textContent()) === 'Renamed again', 'the rename on the view link');
  },

  async 'phone: a press lifts a bar, a tap opens its details'(t) {
    const { edit } = await api.make(plan());
    const page = await t.page(PHONE);
    await page.goto(`${base}/e/${edit}`);
    const bar = page.locator('.it[data-id="barA"]');
    await bar.waitFor();
    // Wherever the page restored its place, bring the bar into view first.
    await page.getByRole('button', { name: 'Back to today' }).click();
    await page.waitForTimeout(400);
    const at = centre(await bar.boundingBox());

    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', at.x, at.y);
    await page.waitForTimeout(500);
    for (let i = 1; i <= 10; i++) await touch('touchMove', at.x + i * 9, at.y);
    await touch('touchEnd');
    const moved = await until(async () => {
      const item = (await api.doc(edit)).items.find((i) => i.id === 'barA');
      return item.start > today() && item;
    }, 'the lifted bar to move');
    assert.equal(moved.end - moved.start, 14);
    assert.equal(moved.lane, 'laneA');

    // A quick touch that moves scrolls the plan, it doesn't drag.
    const now = centre(await bar.boundingBox());
    await touch('touchStart', now.x, now.y);
    for (let i = 1; i <= 6; i++) await touch('touchMove', now.x - i * 12, now.y);
    await touch('touchEnd');
    await page.waitForTimeout(300);
    assert.equal((await api.doc(edit)).items.find((i) => i.id === 'barA').start, moved.start, 'a swipe must not move the bar');

    await page.waitForTimeout(400);
    await bar.tap();
    const name = page.getByRole('textbox', { name: 'Item name' });
    await name.waitFor();
    assert.equal(await name.inputValue(), 'Platform');
    // One day later on the end, from the sheet.
    await page.getByRole('button', { name: 'Ends: a day later' }).tap();
    await until(async () => (await api.doc(edit)).items.find((i) => i.id === 'barA').end === moved.end + 1, 'the end a day later');
  },

  async 'a file out and back in makes the same plan'(t) {
    const { edit } = await api.make(plan());
    const page = await t.page(DESK);
    await page.goto(`${base}/e/${edit}`);
    await page.locator('.it[data-id="barA"]').waitFor();
    await page.getByRole('button', { name: 'Share' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^File/ }).click()]);
    assert.match(download.suggestedFilename(), /^e2e-plan\.linea\.json$/);
    const file = await download.path();

    const [picture] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^Picture/ }).click()]);
    assert.match(picture.suggestedFilename(), /\.png$/);

    await page.goto(base);
    await page.locator('input[type=file]').setInputFiles(file);
    await page.waitForURL((url) => url.pathname.startsWith('/e/') && !url.pathname.endsWith(edit));
    const copy = await api.doc(keyOf(page.url()));
    const original = await api.doc(edit);
    const shape = (doc) => doc.items.map((i) => [i.name, i.start, i.end, i.kind]).sort();
    assert.deepEqual(shape(copy), shape(original));
    assert.deepEqual(copy.lanes.map((l) => l.name), original.lanes.map((l) => l.name));
  },
};

// --- the runner ---------------------------------------------------------------------------------

let failed = 0;
const browser = await chromium.launch({ headless: !flag('--headed') }).catch((error) => {
  child.kill('SIGTERM');
  throw error;
});
for (const [name, test] of Object.entries(tests)) {
  if (grep && !name.includes(grep)) continue;
  const problems = [];
  const contexts = [];
  const t = {
    async page(options) {
      const context = await browser.newContext({ ...options, acceptDownloads: true });
      contexts.push(context);
      const page = await context.newPage();
      page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
      page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
      page.on('request', (r) => !r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && problems.push(`asked another origin: ${r.url()}`));
      return page;
    },
  };
  const started = Date.now();
  try {
    await test(t);
    if (problems.length) throw new Error(problems.join('\n'));
    console.log(`ok   ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}\n     ${String(error.stack ?? error).split('\n').slice(0, 6).join('\n     ')}`);
  } finally {
    for (const c of contexts) await c.close();
  }
}
await browser.close();
child.kill('SIGTERM');
await rm(data, { recursive: true, force: true });
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
