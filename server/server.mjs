// Production server: the built page from ../dist, the timelines' API and live streams (api.mjs) on
// a SQLite file (store.mjs), each timeline's page with its name in the title and link preview, and
// the Census forwarder. No dependencies.
//
//   PORT=8080 HOST=0.0.0.0 LINEA_DATA=./data node server/server.mjs
//
// The environment variables are in the README.

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createCensus } from './census.mjs';
import { openStore } from './store.mjs';
import { createApi } from './api.mjs';

const portFlag = process.argv.indexOf('--port');
const PORT = Number(portFlag > -1 ? process.argv[portFlag + 1] : (process.env.PORT ?? 8080));
const HOST = process.env.HOST ?? '0.0.0.0';
const DIST = path.resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const DATA = path.resolve(process.env.LINEA_DATA ?? fileURLToPath(new URL('../data', import.meta.url)));
const ORIGIN = process.env.LINEA_ORIGIN ?? 'https://linea.ewolution.cloud';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt']);

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  // https only from the first secure visit on (browsers ignore it over plain http).
  'strict-transport-security': 'max-age=31536000',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    // Svelte writes style="" attributes (every bar's place); the shared elements use constructable
    // stylesheets.
    "style-src 'self' 'unsafe-inline'",
    // The picture export draws on a canvas and hands it over as a blob.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; '),
};

const store = openStore(path.join(DATA, 'linea.sqlite'));
const api = createApi({ store });
const census = createCensus({ target: process.env.LINEA_CENSUS ?? '', site: 'linea' });
const compressed = new Map();
let template = null;

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const WORDS = {
  en: { edit: 'A timeline on Linea, open to edit.', view: 'A timeline on Linea.', untitled: 'Untitled timeline' },
  de: { edit: 'Eine Zeitleiste auf Linea, zum Bearbeiten.', view: 'Eine Zeitleiste auf Linea.', untitled: 'Zeitleiste ohne Namen' },
};

/**
 * The page for an address. A timeline's link gets its name as the title and the link preview's
 * title, and nothing else from it: a messenger that fetches the link would carry whatever the
 * preview shows. Timeline pages aren't for search engines.
 */
function render(html, pathname, lang) {
  const match = /^\/([ev])\/([A-Za-z0-9_-]+)\/?$/.exec(pathname);
  if (pathname === '/') return { status: 200, html };
  let status = 404;
  let title = 'Linea';
  let description = null;
  if (match) {
    const page = api.page(match[2]);
    if (page && (page.role === 'edit') === (match[1] === 'e')) {
      status = 200;
      const name = page.name || WORDS[lang].untitled;
      title = `${name} · Linea`;
      description = WORDS[lang][page.role];
    }
  }
  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${escape(title)}`)
    .replace(/(<meta property="og:url" content=")[^"]*/, `$1${ORIGIN}${escape(pathname)}`)
    .replace(/<link rel="canonical"[^>]*>\n?\s*/, '')
    .replace('</head>', '  <meta name="robots" content="noindex" />\n  </head>');
  if (description) {
    html = html
      .replace(/(<meta name="description" content=")[^"]*/, `$1${escape(description)}`)
      .replace(/(<meta property="og:description" content=")[^"]*/, `$1${escape(description)}`);
  }
  return { status, html };
}

async function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = path.join(DIST, path.normalize(decoded));
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return null;
  try {
    const info = await stat(file);
    if (info.isFile()) return { file, size: info.size, mtime: info.mtime };
  } catch {}
  return null;
}

function send(req, res, status, headers, raw, ext) {
  const accept = req.headers['accept-encoding'] ?? '';
  const encoding = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
  if (encoding && COMPRESSIBLE.has(ext)) {
    const body = encoding === 'br' ? zlib.brotliCompressSync(raw) : zlib.gzipSync(raw);
    res.writeHead(status, { ...headers, 'content-encoding': encoding, 'content-length': body.length, vary: 'accept-encoding' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  res.writeHead(status, { ...headers, 'content-length': raw.length });
  res.end(req.method === 'HEAD' ? undefined : raw);
}

async function servePage(req, res, pathname) {
  template ??= await readFile(path.join(DIST, 'index.html'), 'utf8');
  const lang = /^\s*de\b/i.test(req.headers['accept-language'] ?? '') ? 'de' : 'en';
  const page = render(template, pathname, lang);
  const headers = { 'content-type': MIME['.html'], 'cache-control': 'no-cache', vary: 'accept-language' };
  if (pathname !== '/') headers['x-robots-tag'] = 'noindex';
  send(req, res, page.status, headers, Buffer.from(page.html), '.html');
}

async function serveStatic(req, res, pathname) {
  if (pathname === '/robots.txt') {
    // The home only: a timeline's link is its key.
    const robots = 'User-agent: *\nAllow: /$\nDisallow: /e/\nDisallow: /v/\nDisallow: /api/\n';
    return send(req, res, 200, { 'content-type': MIME['.txt'], 'cache-control': 'no-cache' }, Buffer.from(robots), '.txt');
  }
  if (pathname === '/' || pathname === '/index.html') return servePage(req, res, '/');

  const entry = await resolveFile(pathname);
  // A path without an extension is a page: a timeline's link, or a typo, which gets the app with a
  // 404. A missing file with an extension stays a plain 404, so an old /assets/ name after a deploy
  // never gets the HTML.
  if (!entry) {
    if (!path.extname(pathname)) return servePage(req, res, pathname);
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }

  const ext = path.extname(entry.file);
  const headers = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'last-modified': entry.mtime.toUTCString(),
  };

  const accept = req.headers['accept-encoding'] ?? '';
  const encoding = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
  if (encoding && COMPRESSIBLE.has(ext) && entry.size < 8 * 1024 * 1024) {
    const key = `${entry.file}:${entry.mtime.getTime()}:${encoding}`;
    let body = compressed.get(key);
    if (!body) {
      const raw = await readFile(entry.file);
      body = encoding === 'br' ? zlib.brotliCompressSync(raw) : zlib.gzipSync(raw);
      compressed.set(key, body);
    }
    res.writeHead(200, { ...headers, 'content-encoding': encoding, 'content-length': body.length, vary: 'accept-encoding' });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }

  res.writeHead(200, { ...headers, 'content-length': entry.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(entry.file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/healthz') return res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

  try {
    if (await census(req, res)) return;
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (await api.handle(req, res, url)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500).end('Internal error');
    else res.destroy();
  }
});

// Docker stops containers with SIGTERM, which Node ignores as PID 1 unless handled; without
// this, every Watchtower update waits out the 10 s grace period and then kills us. The live
// streams are ended first, so the pages reconnect to the new container at once.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    api.close();
    server.close(() => {
      store.close();
      process.exit(0);
    });
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

server.listen(PORT, HOST, () => {
  console.log(`Linea listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
