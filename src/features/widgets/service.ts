/**
 * The one widget service for the whole app, and the two calls other features make (sync, clear). No React here, so the
 * "Delete everything" code can use it without pulling in the screens.
 */
import { createWidgetService, type WidgetService, type WidgetStore } from '@/core/widgets';
import { getDatabase, secureRandomBytes } from '@/infrastructure/storage/database';
import { createDeviceWidgetStore } from './device-store';
import { widgetEngine } from './engine';
import { createWidgetPlatform } from './platform';

let store: WidgetStore | undefined;
let shared: WidgetService | undefined;

/** The widget definitions on this device. One store for the whole app, so every screen sees the same changes. */
export function getWidgetStore(): WidgetStore {
  if (!store) store = createDeviceWidgetStore();
  return store;
}

/**
 * One widget service for the whole app, over this device's database. Widgets, apps and entries all come from the
 * local database and storage. It never logs: nothing here needs to leave a trace of what a widget shows.
 */
export function getWidgetService(): WidgetService {
  if (!shared) {
    const db = getDatabase();
    shared = createWidgetService({
      store: getWidgetStore(),
      apps: db.apps,
      records: db.records,
      state: db.state,
      platform: createWidgetPlatform(),
      engine: widgetEngine,
      newId: () => Array.from(secureRandomBytes(12), (b) => b.toString(16).padStart(2, '0')).join(''),
    });
  }
  return shared;
}

/** Brings the home screen and the install shortcuts in step with the apps. Safe to call at any time; it never throws. */
export function syncWidgets(reason: 'open' | 'change' = 'open'): Promise<unknown> {
  return getWidgetService().sync(reason);
}

/** "Delete everything": removes every widget, the settings and what the home screen holds. Call it from the wipe. */
export async function clearWidgets(): Promise<void> {
  await getWidgetService().clearAll();
}
