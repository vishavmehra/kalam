/**
 * Every person-facing string of the media inputs and creation sessions (copy rule: plain words, no em dashes,
 * no exclamation marks). The words are the `media.*` part of the i18n catalogue. The core cannot import the i18n
 * code, so it speaks English from `MEDIA_EN` (what Node and the tests read) until the app registers its translator
 * with `setMediaWords` (src/features/media/words.ts); from then on every string is the one in the interface
 * language. The shapes below are what the core and the screens read, as getters and functions so a language
 * switch shows on the next render.
 *
 * Some strings are not for the person but for the compiler or for stored data, and stay English on purpose: the
 * headings and lines handed to the compiler (`handoffCopy` notes and frame labels), the answers a person's choice
 * is recorded as (`correction*`), the names of languages and currencies that identify a conflict, and the default
 * workflow name and step wording that become part of the video summary.
 */
import { MEDIA_EN } from './copy-en';
import type { MediaErrorCode, MediaType, ProcessingStatus } from './types';

type Params = Record<string, string | number>;
/** Looks a key up in the interface language; undefined falls back to English. Registered by the app. */
export type MediaWords = (key: string, params?: Params) => string | undefined;
let words: MediaWords | undefined;
export function setMediaWords(translate: MediaWords | undefined): void {
  words = translate;
}

const fill = (template: string, params?: Params) => template.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''));
/** One string of the copy: the registered translation, else the English table, else the key (so a typo shows). */
function say(key: string, params?: Params): string {
  const heard = words?.(key, params);
  if (heard !== undefined) return heard;
  const en = MEDIA_EN[key];
  if (en === undefined) return key;
  return fill(typeof en === 'string' ? en : params?.count === 1 ? en[0] : en[1], params);
}
const t = say;
const td = say;

/** A group of plain strings, each read from the catalogue every time it is used. Keys are checked by copy.test.ts. */
function lazy<K extends string>(keys: readonly K[], prefix: string): Record<K, string> {
  const group = {} as Record<K, string>;
  for (const k of keys) Object.defineProperty(group, k, { enumerable: true, get: () => td(`${prefix}.${k}`) });
  return group;
}

/** `base` with the getters of `group` added. A spread would read every getter once, at load, and freeze the language. */
function withLazy<T extends object, U extends object>(base: T, group: U): T & U {
  return Object.defineProperties(base, Object.getOwnPropertyDescriptors(group)) as T & U;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const mb = (bytes: number) => t('media.unit.mb', { n: Math.round((bytes / (1024 * 1024)) * 10) / 10 });
const secs = (s: number) => (s >= 120 ? t('media.unit.minutes', { count: Math.round(s / 60) }) : t('media.unit.seconds', { count: Math.round(s) }));

export const KIND_WORD: Record<MediaType, string> = lazy(['image', 'audio', 'video'] as const, 'media.kind');

export interface ErrorDetail {
  type?: MediaType;
  sizeBytes?: number;
  limitBytes?: number;
  durationSec?: number;
  limitSec?: number;
  sniffed?: MediaType;
  /** Name of the platform speech service, e.g. "Android's speech service". */
  service?: string;
  /** Why the online speech service may not be used. */
  blockedBy?: 'offline_only' | 'cloud_off';
}

/** docs/06 §14.2 messages with the recovery from §14.3. */
export function mediaErrorMessage(code: MediaErrorCode, d: ErrorDetail = {}): string {
  const what = d.type ? KIND_WORD[d.type] : t('media.kind.file');
  switch (code) {
    case 'PERMISSION_DENIED':
      return t('media.error.permission');
    case 'FILE_UNSUPPORTED':
      if (d.sniffed && d.type && d.sniffed !== d.type) return t('media.error.unsupportedKind', { found: KIND_WORD[d.sniffed], what });
      return t('media.error.unsupported', { what });
    case 'FILE_TOO_LARGE':
      if (d.durationSec !== undefined && d.limitSec !== undefined) return t('media.error.tooLongDuration', { what, length: secs(d.durationSec), limit: secs(d.limitSec) });
      if (d.sizeBytes !== undefined && d.limitBytes !== undefined) return t('media.error.tooLargeSize', { what, size: mb(d.sizeBytes), limit: mb(d.limitBytes) });
      return t('media.error.tooLarge', { what });
    case 'FILE_CORRUPTED':
      return t('media.error.damaged', { what });
    case 'IMAGE_DECODE_FAILED':
      return t('media.error.imageDecode');
    case 'AUDIO_RECORDING_FAILED':
      return t('media.error.audioRecording');
    case 'AUDIO_TRANSCRIPTION_FAILED':
      return t('media.error.audioTranscription');
    case 'VIDEO_DECODE_FAILED':
      return t('media.error.videoDecode');
    case 'VIDEO_EXTRACTION_FAILED':
      return t('media.error.videoExtraction');
    case 'DRAWING_EXPORT_FAILED':
      return t('media.error.drawingExport');
    case 'ATTACHMENT_STORAGE_FAILED':
      return t('media.error.storage');
    case 'CONTEXT_BUILD_FAILED':
      return t('media.error.contextBuild');
    case 'COMPILER_INPUT_TOO_LARGE':
      return t('media.error.inputTooLarge');
    case 'CLOUD_CONSENT_REQUIRED':
      return t('media.error.cloudConsent');
    case 'NETWORK_UNAVAILABLE':
      return t('media.error.offline');
    case 'PROCESSING_INTERRUPTED':
      return t('media.error.interrupted', { what });
    case 'ATTACHMENT_MISSING':
      return t('media.error.missing', { what });
    case 'SPEECH_CONSENT_REQUIRED':
      return t('media.error.speechConsent', { service: d.service ? capital(d.service) : t('media.error.onlineService') });
    case 'SPEECH_BLOCKED':
      return t(d.blockedBy === 'offline_only' ? 'media.error.speechBlockedOffline' : 'media.error.speechBlockedCloudOff');
  }
}

/** docs/06 §5.2. */
export const STATUS_LABEL: Record<ProcessingStatus, string> = lazy(
  ['pending', 'validating', 'processing_local', 'preparing_cloud', 'ready', 'partial', 'failed'] as const, 'media.status',
);

export const SESSION_LABEL = lazy([
  'draft', 'collecting', 'preprocessing', 'ready_for_review', 'compiling', 'understanding_review', 'completed',
  'attachment_failed', 'preprocessing_failed', 'compilation_failed', 'interrupted', 'cancelled',
] as const, 'media.session');

/** English names: they identify a conflict and go into the answer recorded for the compiler, so they do not change with the interface language. */
export const LANGUAGE_NAME: Record<string, string> = {
  en: 'English', hi: 'Hindi', gu: 'Gujarati', mr: 'Marathi', bn: 'Bengali',
  ta: 'Tamil', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi',
};
export const languageName = (code: string) => LANGUAGE_NAME[code.split('-')[0]!.toLowerCase()] ?? code;

export const CURRENCY_NAME: Record<string, string> = { INR: 'rupees', USD: 'dollars', EUR: 'euros', GBP: 'pounds' };

type Claim = { n: number; where: string };

export const conflictCopy = {
  /** The question. The counts and places are in the interface language. */
  fieldCount: (a: Claim, b: Claim, verb: 'says' | 'shows') =>
    t(verb === 'says' ? 'media.conflict.fieldsSays' : 'media.conflict.fieldsShows', {
      a: a.where, na: t('media.conflict.nField', { count: a.n }), b: b.where, nb: b.n,
    }),
  screenCount: (a: Claim, b: Claim, verb: 'says' | 'shows') =>
    t(verb === 'says' ? 'media.conflict.screensSays' : 'media.conflict.screensShows', {
      a: a.where, na: t('media.conflict.nScreen', { count: a.n }), b: b.where, nb: b.n,
    }),
  language: (spokenOrAsked: string, chosen: string, how: 'mentioned' | 'spoke') =>
    t(how === 'spoke' ? 'media.conflict.languageSpoke' : 'media.conflict.languageAsked', { said: spokenOrAsked, chosen }),
  currency: (a: string, b: string) => t('media.conflict.currency', { a, b }),
  /** The button for one answer. */
  useCount: (n: number, noun: 'fields' | 'screens', where: string) =>
    t(noun === 'fields' ? 'media.conflict.useFields' : 'media.conflict.useScreens', { count: n, where }),
  useLanguage: (name: string) => t('media.conflict.useLanguage', { name }),
  useCurrency: (name: string) => t('media.conflict.useCurrency', { name }),
  /** What a chosen answer is recorded as for the compiler: English, whatever the interface language. */
  correctionCount: (n: number, noun: 'fields' | 'screens', where: string) => `Use ${n} ${noun}, as in ${where}.`,
  correctionLanguage: (name: string) => `Make the app in ${name}.`,
  correctionCurrency: (name: string) => `Show amounts in ${name}.`,
  /** Where a claim was read, in the interface language. */
  where: lazy(['text', 'voice', 'drawing'] as const, 'media.conflict.where'),
  /** The same places in English, for the recorded answer. */
  whereEnglish: { text: 'Your description', voice: 'Your voice note', drawing: 'your drawing' } as const,
  get heading() { return t('media.conflict.heading'); },
  get answered() { return t('media.conflict.answered'); },
  get change() { return t('media.conflict.change'); },
};

export const workflowCopy = withLazy({
  /** Stored with the workflow and read by the compiler: English. */
  defaultName: 'What the video shows',
  untitledStep: (clock: string) => `Step at ${clock}`,
  summaryHeading: (name: string) => `Workflow: ${name}`,
  /** For the person. */
  moveUp: (n: number) => t('media.workflow.moveUp', { n }),
  moveDown: (n: number) => t('media.workflow.moveDown', { n }),
  remove: (n: number) => t('media.workflow.remove', { n }),
  stepLabel: (n: number, clock: string) => t('media.workflow.stepLabel', { n, clock }),
  describedBy: lazy(['draft', 'transcript', 'on_device', 'cloud', 'person'] as const, 'media.workflow.describedBy'),
}, lazy([
  'nameLabel', 'stepPlaceholder', 'heading', 'intro', 'confirm', 'confirmed', 'addStep', 'describeWithAI', 'describing', 'aiFailed', 'locked', 'keptYours', 'noSpeech', 'cloudNote',
] as const, 'media.workflow'));

export const audioCopy = withLazy({
  sounds: (name: string) => t('media.audio.sounds', { name }),
  meta: (clock: string, size: string) => `${clock} · ${size}`,
  pausedAt: (clock: string) => t('media.audio.pausedAt', { clock }),
}, lazy([
  'choose', 'replace', 'stop', 'play', 'pause', 'resume', 'remove', 'transcribe', 'transcribing', 'transcriptLabel', 'transcriptHelper',
  'originalLabel', 'showOriginal', 'hideOriginal', 'restoreOriginal', 'webUnsupported', 'androidTooOld', 'formatUnreadable', 'kept',
  'notKept', 'tooLargeToKeep', 'useOnlineSpeech', 'gone', 'recordingPaused', 'recordingResumed',
] as const, 'media.audio'));

export const videoCopy = withLazy({
  meta: (parts: string[]) => parts.join(' · '),
}, lazy(['choose', 'replace', 'record', 'stop', 'noteLabel', 'noteHelper', 'notKeptOnWeb', 'missing', 'playerLabel'] as const, 'media.video'));

export const attachmentCopy = withLazy({
  remove: (name: string) => t('media.attachment.remove', { name }),
  replace: (name: string) => t('media.attachment.replace', { name }),
  describe: (name: string) => t('media.attachment.describe', { name }),
  zoom: (name: string) => t('media.attachment.zoom', { name }),
  rotate: (name: string) => t('media.attachment.rotate', { name }),
  duplicate: (name: string) => t('media.attachment.duplicate', { name }),
  photoName: (n: number) => t('media.attachment.photoName', { n }),
  audioName: (n: number) => t('media.attachment.audioName', { n }),
  videoName: (n: number) => t('media.attachment.videoName', { n }),
  photoLimit: (n: number) => t('media.attachment.photoLimit', { n }),
  droppedSkipped: (n: number) => t('media.attachment.droppedSkipped', { count: n }),
}, lazy(['noteLabel', 'noteHelper', 'close', 'listLabel', 'originalKept', 'originalTooLarge'] as const, 'media.attachment'));

export const handoffCopy = {
  /** What the compiler reads: English. */
  notesHeading: 'Notes about the attachments:',
  noteLine: (name: string, note: string) => `${name}: ${note}`,
  correctionsHeading: 'Corrections and answers:',
  videoNote: (note: string) => `The person says: ${note}`,
  frameLabel: (n: number, clock: string) => `Video frame ${n} at ${clock}`,
  photoName: (n: number) => `Photo ${n}`,
  audioName: (n: number) => `Recording ${n}`,
  videoName: (n: number) => `Video ${n}`,
  /** What the person reads before building, in the interface language. */
  excluded: (parts: string[], max: number) => t('media.handoff.excluded', { max, parts: parts.join(', ') }),
  excludedPart: (source: 'drawing' | 'photo' | 'video_frame' | 'screenshot', n: number) => td(`media.handoff.part.${source}`, { count: n }),
  notesLeftOut: (n: number) => t('media.handoff.notesLeftOut', { count: n }),
  get descriptionShortened() { return t('media.handoff.descriptionShortened'); },
};

export const sessionCopy = {
  get restored() { return t('media.session.restored'); },
  restoredMissing: (n: number) => t('media.session.restoredMissing', { count: n }),
};
