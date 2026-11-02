# Linea

Timelines you plan together: lanes, bars and milestones dragged into place, shared with a link
instead of an account. Live at [linea.ewolution.cloud](https://linea.ewolution.cloud).

- **A plan on metro lines** (look B, "Metro"). Every lane is a line with its badge (M1, M2 …), every
  bar a section with a stop at either end, every milestone a station. Overlapping bars take parallel
  tracks, a name too long for its bar sits beside it, today is the red line.
- **Drag and drop.** Drag across a lane to draw a bar, drag a bar to move it (in time or to another
  lane), grab a stop to stretch it, a lane's grip to reorder the lanes. Pinch or ⌘/Ctrl and the
  wheel to zoom; Week, Month, Quarter, Year. On a phone a press of 340 ms lifts a bar, a tap opens
  its details in a sheet, the round button adds one.
- **Two links, no accounts.** The edit link changes the plan, the view link only looks (the server
  refuses its changes). Keys are 128 random bits; Make new links replaces both and cuts the old ones
  off at once. The timelines a device has opened are listed on its home.
- **Live.** Every change is a small operation the server numbers and sends to everyone with the
  timeline open over server-sent events; last write wins per field. Undo takes back your own
  steps. A page that drops off catches up from the kept operations (or a snapshot), and keeps its
  last copy to read while offline.
- **Out and in.** The plan as a PNG (the whole plan on white) or a JSON file, which opens again as a
  new timeline.
- **The family's shell.** English and German, light and dark, installs to the home screen with a
  splash, Census counts visits without cookies (the keys are stripped from the paths it sees).

## How it works

`shared/model.mjs` is the one model, run by the server and the page alike: a timeline is
`{ name, lanes, items }`, an item `{ id, lane, name, start, end, kind: 'bar' | 'ms', colour, note }`
with whole UTC days (`end` exclusive). Every change is a list of ops (`name`, `lane+`, `lane`,
`lane-`, `order`, `item+`, `item`, `item-`); `cleanOp` checks one against the limits, `apply` runs it,
`inverse` makes undo's ops.

The page (`src/lib/board.svelte.ts`) applies a batch at once on top of the last confirmed timeline,
posts it (`POST /api/t/<edit>/ops`, one at a time) and drops it from its pending list when the server's
echo comes back with its number. The server (`server/api.mjs`) keeps each open timeline in memory,
applies the batch, saves it with its number in SQLite (`server/store.mjs`, `node:sqlite`, WAL), and
sends it to every stream (`GET /api/t/<key>/live?since=`). A stream that reconnects gets the batches
it missed, or a snapshot when they're older than the last 500. Presence (who is here, who holds
which bar) goes the same way, unsaved.

`src/components/Timeline.svelte` draws the plan (`src/lib/layout.ts` packs each lane's tracks) and
runs one pointer engine for mouse, pen and touch: a mouse drags at once, a finger scrolls unless it
holds still for 340 ms. A tap's follow-up click is swallowed, since a sheet that opens on the tap
would otherwise take it on its backdrop.

## Run it

```bash
npm install
npm run dev         # http://localhost:7510, the API in Vite's dev server (data/dev.sqlite)
npm run check       # svelte-check
npm test            # unit tests: the model, the API (an in-memory store, real SSE), Census's forwarder
npm run test:e2e    # Playwright against a fresh production build: drag, live, view link, touch, files
npm run build && npm start   # the production server on :8080 (PORT to change it)
```

The end-to-end tests run locally before a push; CI runs the type check, the unit tests, the build
and a smoke test of the production server.

## Deploy (NAS)

A push to `release` runs the checks (`ci.yml`) and publishes `ghcr.io/ewolution94/linea:latest`
(amd64 and arm64); the shared Watchtower deploys it. The stack is `deploy/portainer-stack.yml`, not
`docker-compose.yml` (that one builds from source). The timelines live in the `linea-data` volume.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8080` | Where the server listens (the NAS stack sets its registry port). |
| `HOST` | `0.0.0.0` | |
| `LINEA_DATA` | `./data` (`/data` in the image) | The folder for `linea.sqlite`. |
| `LINEA_ORIGIN` | `https://linea.ewolution.cloud` | The origin in canonical links and link previews. |
| `LINEA_CENSUS` | off | Census's ingest origin (`http://census:4901` on the `ewolution` network). |

## Project layout

```
shared/model.mjs     the timeline, its ops, their checks and limits, apply and inverse (server and page)
server/              server.mjs (static, page heads, headers), api.mjs (timelines, ops, SSE, presence),
                     store.mjs (SQLite), census.mjs (the forwarder, keys stripped)
src/lib/             board (the live document), view (zoom, selection, sheets), layout, dates, files
                     (JSON, PNG, the example), recent, prefs, i18n and strings, router, theme
src/components/      BoardPage, Timeline (canvas and drag engine), ItemSheet, LaneSheet, Share, People,
                     Settings, Home
vendor/ewo/          Folio's tokens and elements (npm run vendor -- linea, in Folio)
tests/               node --test; e2e/run.mjs (Playwright, local)
```
