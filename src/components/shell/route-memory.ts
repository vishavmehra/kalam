/**
 * Route restore (docs/03 §3.2 "Restore the previous screen when feasible"): a reload of the web page puts the person
 * back on the screen they were on instead of the shelf. The path alone is kept (never the query, so a typed idea or a
 * share code is not stored), in sessionStorage: it survives a reload of this tab and is gone when the tab closes, so a
 * fresh visit still starts at the shelf. Phones keep the process alive, and a cold start opens the shelf.
 * Pure helpers plus a thin storage wrapper that never throws.
 */
export const LAST_ROUTE_KEY = 'kalam.lastRoute.v1';

/** Screens that are safe to come back to. A form that needs a session, or a one-time link, is not listed. */
const RESTORABLE: readonly RegExp[] = [
  /^\/(create|activity|settings|account|queue|templates)$/,
  /^\/create\/draw$/,
  /^\/bazaar(\/(library|mine|wallet|[A-Za-z0-9_~.%-]{1,120}))?$/,
  /^\/app\/[A-Za-z0-9_~.%-]{1,120}(\/edit)?$/,
];
/** Words in the Bazaar folder that look like listing ids but are one-off screens. */
const NOT_AN_ID = new Set(['/bazaar/publish', '/bazaar/moderation']);

/** The path to remember, or null when the screen is not one to come back to. Query and hash are dropped. */
export function restorablePath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const path = raw.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  if (path.length > 200 || NOT_AN_ID.has(path)) return null;
  return RESTORABLE.some((re) => re.test(path)) ? path : null;
}

/** How this page load began: a reload or the back button returns to the saved screen; a typed address or a link opens the shelf. */
export function navigationType(): string | undefined {
  try {
    const entry = typeof performance === 'undefined' ? undefined : (performance.getEntriesByType('navigation')[0] as { type?: string } | undefined);
    return entry?.type;
  } catch {
    return undefined;
  }
}

/**
 * Where to go on start: only after a reload (or back and forward), only from the shelf's own address, and only to a saved
 * screen that is still restorable.
 */
export function routeToRestore({ pathname, saved, navType }: { pathname: string; saved: string | null | undefined; navType: string | undefined }): string | null {
  if (navType !== 'reload' && navType !== 'back_forward') return null;
  if (pathname !== '/' && pathname !== '') return null;
  return restorablePath(saved);
}

const store = (): Storage | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
};

export function readLastRoute(): string | null {
  try {
    return store()?.getItem(LAST_ROUTE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** The shelf clears the memory, a restorable screen saves its path, anything else leaves it as it was. */
export function rememberRoute(pathname: string): void {
  try {
    const s = store();
    if (!s) return;
    if (pathname === '/' || pathname === '') s.removeItem(LAST_ROUTE_KEY);
    else {
      const path = restorablePath(pathname);
      if (path) s.setItem(LAST_ROUTE_KEY, path);
    }
  } catch {
    // Storage blocked: the shelf is a fine place to start.
  }
}
