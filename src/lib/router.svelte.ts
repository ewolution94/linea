/**
 * Addresses: `/` is the home, `/e/<key>` a timeline to edit, `/v/<key>` one to view. One document
 * serves them all (the server writes a timeline's name into its title); moving between them is the
 * History API.
 */

export const route = $state({ path: location.pathname });

addEventListener('popstate', () => {
  route.path = location.pathname;
});

/** Opens an address in the page. */
export function go(path: string, { replace = false } = {}) {
  if (path === location.pathname) return;
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  route.path = path;
  scrollTo({ top: 0 });
}

/** For `<a href>` in the app: a plain click stays in the page; a modified one opens a tab. */
export function nav(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const a = (event.currentTarget as HTMLElement).closest('a');
  if (!a || a.target === '_blank' || a.origin !== location.origin) return;
  event.preventDefault();
  go(a.pathname);
}

/** The timeline an address opens, if it's one. */
export function timelineOf(path: string): { key: string; role: 'edit' | 'view' } | null {
  const m = /^\/([ev])\/([A-Za-z0-9_-]{22})\/?$/.exec(path);
  return m ? { key: m[2], role: m[1] === 'e' ? 'edit' : 'view' } : null;
}
