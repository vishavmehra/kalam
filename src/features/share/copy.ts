/**
 * Everything the person reads in the sharing screens (docs/14 §16). One file so the i18n migration can
 * move it. Plain English: short sentences, no dashes as punctuation, no exclamation marks, no ids.
 * Sentences that explain a link come from `src/core/share/copy.ts`.
 */
import { joinList } from '@/core/share';
import type { ShareIntent } from './model';
import { t as gt } from '@/i18n/active';

export const SHARE_UI = {
  get button() { return gt('share.ui.button'); },
  get buttonHint() { return gt('share.ui.buttonHint'); },

  sheetTitle: (appName: string) => gt('share.ui.sheetTitle', { appName }),
  get sheetIntro() { return gt('share.ui.sheetIntro'); },
  get loading() { return gt('share.ui.loading'); },
  get loadFailed() { return gt('share.ui.loadFailed'); },

  empty: {
    get title() { return gt('share.ui.empty.title'); },
    get description() { return gt('share.ui.empty.description'); },
  },
  get newLink() { return gt('share.ui.newLink'); },
  get listHeading() { return gt('share.ui.listHeading'); },

  card: {
    status: { get on() { return gt('share.ui.card.status.on'); }, get paused() { return gt('share.ui.card.status.paused'); }, get off() { return gt('share.ui.card.status.off'); } },
    kind: { get read() { return gt('share.ui.card.kind.read'); }, get write() { return gt('share.ui.card.kind.write'); } },
    to: (source: string, destination: string) => gt('share.ui.card.to', { source, destination }),
    fields: (labels: readonly string[]) => gt('share.ui.card.fields', { fields: joinList(labels) }),
    bazaar: (name: string) => gt('share.ui.card.bazaar', { name }),
    sentFromThere: (source: string) => gt('share.ui.card.sentFromThere', { source }),
    turnedOffOn: (date: string) => gt('share.ui.card.turnedOffOn', { date }),
    get turnedOffNote() { return gt('share.ui.card.turnedOffNote'); },
    get history() { return gt('share.ui.card.history'); },
    get send() { return gt('share.ui.card.send'); },
    get turnOff() { return gt('share.ui.card.turnOff'); },
    get remove() { return gt('share.ui.card.remove'); },
  },

  confirmOff: {
    get title() { return gt('share.ui.confirmOff.title'); },
    message: (source: string, destination: string) => gt('share.ui.confirmOff.message', { destination, source }),
    get confirm() { return gt('share.ui.confirmOff.confirm'); },
  },
  confirmRemove: {
    get title() { return gt('share.ui.confirmRemove.title'); },
    get message() { return gt('share.ui.confirmRemove.message'); },
    get confirm() { return gt('share.ui.confirmRemove.confirm'); },
  },
  get turnedOff() { return gt('share.ui.turnedOff'); },
  get removed() { return gt('share.ui.removed'); },
  get actionFailed() { return gt('share.ui.actionFailed'); },
  get cancel() { return gt('share.ui.cancel'); },
  get close() { return gt('share.ui.close'); },

  history: {
    get created() { return gt('share.ui.history.created'); },
    get revoked() { return gt('share.ui.history.revoked'); },
    sent: (created: number, updated: number) => {
      const parts: string[] = [];
      if (created) parts.push(gt('share.ui.history.sentNew', { count: created }));
      if (updated) parts.push(gt('share.ui.history.sentUpdated', { count: updated }));
      return parts.length ? parts.join(', ') : gt('share.ui.history.nothingNew');
    },
    get blocked() { return gt('share.ui.history.blocked'); },
    get someRejected() { return gt('share.ui.history.someRejected'); },
  },

  intent: {
    view_from: {
      get label() { return gt('share.ui.intent.view_from.label'); },
      get description() { return gt('share.ui.intent.view_from.description'); },
    },
    let_view: {
      get label() { return gt('share.ui.intent.let_view.label'); },
      get description() { return gt('share.ui.intent.let_view.description'); },
    },
    send_to: {
      get label() { return gt('share.ui.intent.send_to.label'); },
      get description() { return gt('share.ui.intent.send_to.description'); },
    },
    receive_from: {
      get label() { return gt('share.ui.intent.receive_from.label'); },
      get description() { return gt('share.ui.intent.receive_from.description'); },
    },
  } satisfies Record<ShareIntent, { label: string; description: string }>,

  form: {
    get title() { return gt('share.ui.form.title'); },
    get intentLabel() { return gt('share.ui.form.intentLabel'); },
    get appLabel() { return gt('share.ui.form.appLabel'); },
    get noOtherApp() { return gt('share.ui.form.noOtherApp'); },
    sourceList: (appName: string) => gt('share.ui.form.sourceList', { appName }),
    destinationList: (appName: string) => gt('share.ui.form.destinationList', { appName }),
    get noLists() { return gt('share.ui.form.noLists'); },
    get fieldsHeading() { return gt('share.ui.form.fieldsHeading'); },
    get fieldsHelp() { return gt('share.ui.form.fieldsHelp'); },
    get notShared() { return gt('share.ui.form.notShared'); },
    fieldGroup: (label: string) => gt('share.ui.form.fieldGroup', { label }),
    get noFields() { return gt('share.ui.form.noFields'); },
    get previewHeading() { return gt('share.ui.form.previewHeading'); },
    bazaarSwitch: (name: string) => gt('share.ui.form.bazaarSwitch', { name }),
    bazaarHelp: (name: string) => gt('share.ui.form.bazaarHelp', { name }),
    get allow() { return gt('share.ui.form.allow'); },
    get back() { return gt('share.ui.form.back'); },
    blockers: {
      get pickApp() { return gt('share.ui.form.blockers.pickApp'); },
      get pickLists() { return gt('share.ui.form.blockers.pickLists'); },
      get pickFields() { return gt('share.ui.form.blockers.pickFields'); },
      bazaar: (name: string) => gt('share.ui.form.blockers.bazaar', { name }),
    },
  },

  send: {
    title: (destination: string) => gt('share.ui.send.title', { destination }),
    help: (fields: readonly string[]) => gt(fields.length === 1 ? 'share.ui.send.helpOne' : 'share.ui.send.helpMany', { fields: joinList(fields) }),
    get loading() { return gt('share.ui.send.loading'); },
    get empty() { return gt('share.ui.send.empty'); },
    get failed() { return gt('share.ui.send.failed'); },
    get selectAll() { return gt('share.ui.send.selectAll'); },
    get clear() { return gt('share.ui.send.clear'); },
    get sentBefore() { return gt('share.ui.send.sentBefore'); },
    more: (shown: number, total: number) => gt('share.ui.send.more', { shown, total }),
    get listLabel() { return gt('share.ui.send.listLabel'); },
    chosen: (n: number) => (n === 0 ? gt('share.ui.send.noneChosen') : gt('share.ui.send.chosenCount', { n })),
    get update() { return gt('share.ui.send.update'); },
    get updateHelp() { return gt('share.ui.send.updateHelp'); },
    action: (n: number) => gt('share.ui.send.action', { count: n }),
    get nothingToDo() { return gt('share.ui.send.nothingToDo'); },
    confirmTitle: (destination: string) => gt('share.ui.send.confirmTitle', { destination }),
    confirmMessage: (plan: { create: number; change: number; leftOut: number }, fields: readonly string[], destination: string) => {
      const parts: string[] = [];
      if (plan.create) parts.push(gt('share.ui.send.planCreate', { count: plan.create }));
      if (plan.change) parts.push(gt('share.ui.send.planChange', { count: plan.change }));
      if (plan.leftOut) parts.push(gt('share.ui.send.planLeftOut', { count: plan.leftOut }));
      parts.push(gt(fields.length === 1 ? 'share.ui.send.onlyOne' : 'share.ui.send.onlyMany', { fields: joinList(fields), destination }));
      return parts.join(' ');
    },
    get confirm() { return gt('share.ui.send.confirm'); },
    get back() { return gt('share.ui.send.back'); },
    limit: (n: number) => gt('share.ui.send.limit', { n }),
  },
} as const;
