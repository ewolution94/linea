/**
 * Census, the self-hosted visit counter: no cookies, nothing stored on the device, and never a
 * timeline's link. The beacon comes from our own origin (server/census.mjs forwards /_e.js and /_e),
 * so the CSP stays 'self'. A timeline's page is counted as /e or /v, without its key.
 *
 * Production only, like the service worker.
 */
let loaded = false;

export function loadCensus() {
  if (loaded || !import.meta.env.PROD) return;
  loaded = true;
  const script = document.createElement('script');
  script.src = '/_e.js';
  document.head.append(script);
}
