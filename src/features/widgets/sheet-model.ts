/**
 * What the "Add to home screen" sheet may offer and say, without React. Kept apart so the rules can be tested.
 */
import type { PinOutcome, SyncResult, WidgetAvailability } from '@/core/widgets';
import { WIDGET_UI } from './copy';

export interface WidgetAbilities {
  /**
   * A widget can be made, changed and removed. True on every platform once the device has answered: where there is no
   * home screen widget (the web, Expo Go, a build without the module) the widget shows as a card on the shelf instead.
   */
  canCreate: boolean;
  /** The system can be asked to put a widget on the home screen. Only this gates "Add to home screen". */
  canPin: boolean;
  /** Widgets made here appear on the shelf only, not on a home screen. */
  shelfOnly: boolean;
}

export function widgetAbilities(a: WidgetAvailability | undefined): WidgetAbilities {
  return { canCreate: a !== undefined, canPin: a?.supported === true && a.canPin, shelfOnly: a?.supported === false };
}

/** What to say after a widget is saved. */
export function savedMessage(sync: SyncResult): string {
  if (sync.platform === 'failed') return WIDGET_UI.status.syncFailed;
  return sync.platform === 'unsupported' ? WIDGET_UI.added.savedCard : WIDGET_UI.added.saved;
}

/** What to say after "Save and add to home screen". `saved` is what `savedMessage` said for the save itself. */
export function addedMessage(saved: string, added: { ok: boolean; message: string; outcome: PinOutcome }): string {
  if (added.ok) return added.message;
  // Already says the widget is saved: do not say it twice.
  if (!added.outcome.ok && added.outcome.reason === 'not_published') return added.message;
  return `${saved} ${added.message}`;
}
