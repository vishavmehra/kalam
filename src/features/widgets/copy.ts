/**
 * Everything the person reads in the widget screens (docs/14 §18). One file so the i18n migration can move it.
 * Plain English: short sentences, no dashes as punctuation, no exclamation marks, no ids.
 * Sentences about one saved widget come from `src/core/widgets/copy.ts` and `describe.ts`.
 */
import { WIDGET_COPY, type WidgetAvailability } from '@/core/widgets';
import { t as gt } from '@/i18n/active';

export const WIDGET_UI = {
  get button() { return gt('widgets.ui.button'); },
  get buttonHint() { return gt('widgets.ui.buttonHint'); },

  sheetTitle: (appName: string) => gt('widgets.ui.sheetTitle', { appName }),
  get sheetIntro() { return gt('widgets.ui.sheetIntro'); },
  get loading() { return gt('widgets.ui.loading'); },
  get loadFailed() { return gt('widgets.ui.loadFailed'); },

  empty: {
    get title() { return gt('widgets.ui.empty.title'); },
    get description() { return gt('widgets.ui.empty.description'); },
  },
  get newWidget() { return gt('widgets.ui.newWidget'); },
  get listHeading() { return gt('widgets.ui.listHeading'); },

  card: {
    onHomeScreen: (n: number) => gt('widgets.ui.card.onHomeScreen', { count: n }),
    get notOnHomeScreen() { return gt('widgets.ui.card.notOnHomeScreen'); },
    get add() { return gt('widgets.ui.card.add'); },
    get edit() { return gt('widgets.ui.card.edit'); },
    get remove() { return gt('widgets.ui.card.remove'); },
    get removeTitle() { return gt('widgets.ui.card.removeTitle'); },
    get removeMessage() { return gt('widgets.ui.card.removeMessage'); },
    get brokenFix() { return gt('widgets.ui.card.brokenFix'); },
  },

  form: {
    get titleNew() { return gt('widgets.ui.form.titleNew'); },
    get titleEdit() { return gt('widgets.ui.form.titleEdit'); },
    get showHeading() { return gt('widgets.ui.form.showHeading'); },
    get showNone() { return gt('widgets.ui.form.showNone'); },
    get showHint() { return gt('widgets.ui.form.showHint'); },
    kind: { get stat() { return gt('widgets.ui.form.kind.stat'); }, get list() { return gt('widgets.ui.form.kind.list'); }, get count() { return gt('widgets.ui.form.kind.count'); } },
    get nameLabel() { return gt('widgets.ui.form.nameLabel'); },
    get nameHelper() { return gt('widgets.ui.form.nameHelper'); },
    get nameRequired() { return gt('widgets.ui.form.nameRequired'); },
    get rowsLabel() { return gt('widgets.ui.form.rowsLabel'); },
    get fieldsHeading() { return gt('widgets.ui.form.fieldsHeading'); },
    get fieldsHint() { return gt('widgets.ui.form.fieldsHint'); },
    get fieldsNone() { return gt('widgets.ui.form.fieldsNone'); },
    fieldCheck: (label: string) => gt('widgets.ui.form.fieldCheck', { label }),
    get sizeLabel() { return gt('widgets.ui.form.sizeLabel'); },
    size: { get small() { return gt('widgets.ui.form.size.small'); }, get medium() { return gt('widgets.ui.form.size.medium'); } },
    get refreshLabel() { return gt('widgets.ui.form.refreshLabel'); },
    refresh: { get live() { return gt('widgets.ui.form.refresh.live'); }, get on_open() { return gt('widgets.ui.form.refresh.on_open'); } },
    get lockLabel() { return gt('widgets.ui.form.lockLabel'); },
    lockHelp: {
      get on() { return gt('widgets.ui.form.lockHelp.on'); },
      get off() { return gt('widgets.ui.form.lockHelp.off'); },
    },
    get tapHeading() { return gt('widgets.ui.form.tapHeading'); },
    get tapOpenApp() { return gt('widgets.ui.form.tapOpenApp'); },
    tapOpenScreen: (title: string) => gt('widgets.ui.form.tapOpenScreen', { title }),
    get previewHeading() { return gt('widgets.ui.form.previewHeading'); },
    get previewFailed() { return gt('widgets.ui.form.previewFailed'); },
    get save() { return gt('widgets.ui.form.save'); },
    get saveAndAdd() { return gt('widgets.ui.form.saveAndAdd'); },
    get back() { return gt('widgets.ui.form.back'); },
  },

  added: {
    get saved() { return gt('widgets.ui.added.saved'); },
    /** Saved on a device with no home screen widgets: it shows on the shelf. */
    get savedCard() { return gt('widgets.ui.added.savedCard'); },
    get removed() { return gt('widgets.ui.added.removed'); },
    get asked() { return gt('widgets.ui.added.asked'); },
    get declined() { return gt('widgets.ui.added.declined'); },
  },

  /** Plain reasons a device cannot add a widget from the app, and what to do instead. */
  platform: {
    android: {
      get cannotPin() { return gt('widgets.ui.platform.android.cannotPin'); },
    },
    get ios() { return gt('widgets.ui.platform.ios'); },
    get web() { return gt('widgets.ui.platform.web'); },
    unavailable: (reason: string) => gt('widgets.ui.platform.unavailable', { reason }),
  },

  settings: {
    get title() { return gt('widgets.ui.settings.title'); },
    get intro() { return gt('widgets.ui.settings.intro'); },
    get allHeading() { return gt('widgets.ui.settings.allHeading'); },
    get none() { return gt('widgets.ui.settings.none'); },
    get appGone() { return gt('widgets.ui.settings.appGone'); },
    get webShortcutsLabel() { return gt('widgets.ui.settings.webShortcutsLabel'); },
    get webShortcutsHelp() { return gt('widgets.ui.settings.webShortcutsHelp'); },
    get clearAll() { return gt('widgets.ui.settings.clearAll'); },
    get clearTitle() { return gt('widgets.ui.settings.clearTitle'); },
    get clearMessage() { return gt('widgets.ui.settings.clearMessage'); },
    get cleared() { return gt('widgets.ui.settings.cleared'); },
    get open() { return gt('widgets.ui.settings.open'); },
    get done() { return gt('widgets.ui.settings.done'); },
  },

  /** The shelf's cards (docs/14 §18.3: dashboard cards on the web). */
  cards: {
    get heading() { return gt('widgets.ui.cards.heading'); },
    /** Read after the card's own words, so a screen reader hears what the card shows and then what a tap does. */
    get hint() { return gt('widgets.ui.cards.hint'); },
  },

  /** Short status lines. */
  status: {
    get saveFailed() { return gt('widgets.ui.status.saveFailed'); },
    syncFailed: WIDGET_COPY.status.home_not_updated,
  },

  /** Read out for a tick in a list row. */
  preview: { get done() { return gt('widgets.ui.preview.done'); }, get notDone() { return gt('widgets.ui.preview.notDone'); } },
} as const;

/** What the sheet tells the person about adding a widget on this device. Empty when the Add button is enough. */
export function platformNotice(a: WidgetAvailability | undefined): string | undefined {
  if (!a) return undefined;
  if (!a.supported) return a.platform === 'web' ? WIDGET_UI.platform.web : WIDGET_UI.platform.unavailable(a.reason);
  if (!a.canPin) return a.platform === 'ios' ? WIDGET_UI.platform.ios : WIDGET_UI.platform.android.cannotPin;
  return undefined;
}
