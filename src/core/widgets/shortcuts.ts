/**
 * Install shortcuts for the web app (docs/14 §18.3: App Shelf shortcuts, installable PWA shortcuts).
 *
 * When Kalam is installed from a browser, a long press or right click on its icon can list a few places to jump
 * to. "New app" is fixed (scripts/build-pwa.mjs). The apps the person pinned on the shelf can be added to that
 * list, only after they switch it on in widget settings. The list is a name and an address, nothing else, and it
 * is kept on this device.
 */
import { WIDGET_LIMITS } from './model';

export interface WebShortcut {
  name: string;
  /** Same-origin path, always `/app/<id>`. */
  url: string;
}

/** Longest name the install menu prints without cutting it. */
export const SHORTCUT_NAME = 30;
export const SHORTCUT_URL = /^\/app\/[a-z][a-z0-9_-]{2,63}$/;

interface ShortcutApp {
  id: string;
  pinned?: boolean;
  archived?: boolean;
  lastOpenedAt?: number;
  updatedAt?: number;
  spec: { name: string };
}

/** Pinned, not archived apps, most recently opened first, at most `max`. */
export function pinnedShortcuts(apps: readonly ShortcutApp[], max: number = WIDGET_LIMITS.shortcuts): WebShortcut[] {
  return apps
    .filter((a) => a.pinned && !a.archived)
    .sort((a, b) => (b.lastOpenedAt ?? b.updatedAt ?? 0) - (a.lastOpenedAt ?? a.updatedAt ?? 0))
    .flatMap((a): WebShortcut[] => {
      const name = a.spec.name.trim().slice(0, SHORTCUT_NAME);
      const url = `/app/${a.id}`;
      return name && SHORTCUT_URL.test(url) ? [{ name, url }] : [];
    })
    .slice(0, max);
}
