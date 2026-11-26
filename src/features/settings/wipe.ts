/**
 * "Delete everything" (docs/11 §6.5). Removes every app (with its versions, records and files),
 * drawing, unfinished draft, saved AI answer, translation and the activity log from this device.
 * Settings and the non-personal creation preferences stay, as the Settings screen says.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearShareViews } from '@/features/bazaar-moderation/consent';
import { syncAllReminders } from '@/features/reminders/runtime';
import { clearWidgets } from '@/features/widgets/service';
import { getDatabase } from '@/infrastructure/storage/database';
import { flushCreationDraft, useCreationStore } from '@/state/creation-store';

/** Per-app view language picked in a running app (runtime/translation/use-app-translation.ts). */
const appLanguageKey = (appId: string) => `kalam.appLanguage.${appId}`;

export async function wipeLocalData(): Promise<void> {
  // Account sync off first: otherwise the sync engine sees the apps vanish and downloads them again.
  // The copies in the person's account are not deleted; they can turn sync on again later.
  // Loaded lazily: the sync service pulls in the Firebase and React Native layers.
  try {
    const { getAccountSync } = await import('@/infrastructure/account-sync/service');
    await getAccountSync().setChoice('off');
  } catch (e) {
    console.warn('[kalam] could not turn account sync off before deleting', e instanceof Error ? e.name : 'error');
  }
  // The draft on screen goes first, so a queued autosave cannot write the words and photos back.
  useCreationStore.getState().resetSession();
  await flushCreationDraft();

  const db = getDatabase();
  const [apps, drawings, sessions] = await Promise.all([db.apps.list(), db.drawings.list(), db.sessions.list()]);
  for (const a of apps) await db.apps.remove(a.id);
  for (const d of drawings) await db.drawings.remove(d.id);
  for (const s of sessions) await db.sessions.remove(s.id);
  await db.aiCache.clear();
  await db.clearTranslations();
  await db.events.clear();
  // Files whose owner is already gone (an interrupted save, an older build).
  await db.removeUnusedFiles();
  await Promise.all(apps.map((a) => AsyncStorage.removeItem(appLanguageKey(a.id)).catch(() => undefined)));
  // Reminder texts name records: cancel what was scheduled for the deleted apps before reporting success.
  await syncAllReminders().catch(() => undefined);
  // Widget definitions and what the home screen holds, then the Bazaar view-count choice (a setting kept on this device).
  await clearWidgets().catch(() => undefined);
  await clearShareViews();
}
