/**
 * Words the 1.1 runtime parts show or speak, in the app's language (`runtime.v11.*` in the catalogues).
 * `v11Words(spec.lang)` for an app; `V11_COPY` is the English set. Plain English, one place (copy rule).
 */
import type { TFunction } from '@/i18n/translator';
import { appT } from '../words';

function build(t: TFunction) {
  const n = (count: number) => ({ count });
  return {
    // Relations
    untitled: t('runtime.v11.untitled'),
    missingLink: t('runtime.v11.missingLink'),
    noLinkChosen: t('runtime.v11.noLinkChosen'),
    chooseLink: (label: string) => t('runtime.v11.chooseLink', { label }),
    clearLink: t('runtime.v11.clearLink'),
    searchLinks: t('runtime.v11.searchLinks'),
    noLinkOptions: (collection: string) => t('runtime.v11.noLinkOptions', { collection }),
    noLinkMatches: t('runtime.v11.noLinkMatches'),
    deleteBlocked: (count: number, collection: string) => t('runtime.v11.deleteBlocked', { count, collection }),
    deleteTooMany: t('runtime.v11.deleteTooMany'),
    alsoDeletes: (count: number) => t('runtime.v11.alsoDeletes', n(count)),
    alsoClears: (count: number) => t('runtime.v11.alsoClears', n(count)),
    deleteFailed: t('runtime.v11.deleteFailed'),
    deletePartly: t('runtime.v11.deletePartly'),
    deleteChanged: t('runtime.v11.deleteChanged'),
    linkNotFound: t('runtime.v11.linkNotFound'),
    signatureNotDrawn: t('runtime.v11.signatureNotDrawn'),
    // Timer
    start: t('runtime.v11.start'),
    pause: t('runtime.v11.pause'),
    resume: t('runtime.v11.resume'),
    reset: t('runtime.v11.reset'),
    timeUp: (label: string) => t('runtime.v11.timeUp', { label }),
    timerValue: (spoken: string) => t('runtime.v11.timerValue', { spoken }),
    timerLeft: (spoken: string) => t('runtime.v11.timerLeft', { spoken }),
    seconds: (count: number) => t('runtime.v11.seconds', n(count)),
    minutes: (count: number) => t('runtime.v11.minutes', n(count)),
    hours: (count: number) => t('runtime.v11.hours', n(count)),
    // Reminder
    remindMe: t('runtime.v11.remindMe'),
    reminderStatus: {
      off: t('runtime.v11.reminderStatus.off'),
      on: t('runtime.v11.reminderStatus.on'),
      no_permission: t('runtime.v11.reminderStatus.no_permission'),
      unsupported: t('runtime.v11.reminderStatus.unsupported'),
      error: t('runtime.v11.reminderStatus.error'),
    },
    reminderWhy: (reason: string) => t('runtime.v11.reminderWhy', { reason }),
    reminderWhen: (lead: number, field: string, time: string) =>
      lead === 0 ? t('runtime.v11.reminderOnDay', { field, time }) : t('runtime.v11.reminderBefore', { count: lead, field, time }),
    reminderSkipsDone: (field: string) => t('runtime.v11.reminderSkipsDone', { field }),
    reminderSaveFailed: t('runtime.v11.reminderSaveFailed'),
    openSettings: t('runtime.v11.openSettings'),
    // Signature
    signHere: t('runtime.v11.signHere'),
    signed: t('runtime.v11.signed'),
    clearSignature: t('runtime.v11.clearSignature'),
    signatureTooLong: t('runtime.v11.signatureTooLong'),
    signatureA11y: (label: string, signed: boolean) => t(signed ? 'runtime.v11.signedState' : 'runtime.v11.unsignedState', { label }),
    typeInstead: t('runtime.v11.typeInstead'),
    drawInstead: t('runtime.v11.drawInstead'),
    typeToSign: t('runtime.v11.typeToSign'),
    // Suggested Access Modes (offered, never switched on by the app itself)
    modeNames: {
      large: t('runtime.v11.modeLarge'),
      highContrast: t('runtime.v11.modeHighContrast'),
      simple: t('runtime.v11.modeSimple'),
      readAloud: t('runtime.v11.modeReadAloud'),
    },
    modesOffer: (names: readonly string[]) => {
      const list = names.length > 1
        ? t('runtime.v11.listAnd', { head: names.slice(0, -1).join(', '), last: names[names.length - 1] })
        : (names[0] ?? '');
      return t(names.length > 1 ? 'runtime.v11.modesOfferMany' : 'runtime.v11.modesOfferOne', { list });
    },
    turnOn: t('runtime.v11.turnOn'),
    notNow: t('runtime.v11.notNow'),
  };
}

export type V11Words = ReturnType<typeof build>;

const memo = new WeakMap<TFunction, V11Words>();

/** The 1.1 words for an app language (English until that language's catalogue has loaded). */
export function v11Words(lang?: string | null): V11Words {
  const t = appT(lang);
  let words = memo.get(t);
  if (!words) memo.set(t, (words = build(t)));
  return words;
}

/** The English words, for tests and for code with no app at hand. */
export const V11_COPY: V11Words = v11Words('en');
