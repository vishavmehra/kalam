/**
 * Commands that belong to the voice agent itself, not to the app (docs/10 §4.5, docs/03 §19.6):
 * repeat, stop talking, help, cancel, go back, and reading a spoken "confirm" or "cancel".
 * Whole-utterance matching only, so a word inside a name ("Stop Sharma") is never a command.
 * English, Hinglish and Hindi. Pure TypeScript.
 */
export type MetaCommand = 'repeat' | 'stop' | 'help' | 'back' | 'cancel';

/** Lower-case words of an utterance: punctuation removed, apostrophes and every script kept. */
export function speechWords(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const POLITE = new Set(['please', 'pls', 'ji', 'zara', 'kijiye', 'karo', 'कीजिए', 'कृपया']);

function core(text: string): string {
  return speechWords(text).filter((w) => !POLITE.has(w)).join(' ');
}

const META: Record<MetaCommand, string[]> = {
  repeat: [
    'repeat', 'repeat that', 'say that again', 'say again', 'again', 'what did you say', 'phir se', 'dobara', 'dubara',
    'फिर से', 'दोबारा',
  ],
  stop: ['stop', 'stop talking', 'be quiet', 'quiet', 'silence', 'shut up', 'chup', 'chup raho', 'चुप', 'चुप रहो'],
  help: [
    'help', 'what can i say', 'what can i do', 'commands', 'options', 'kya bol sakta hoon', 'kya bol sakti hoon',
    'madad', 'मदद', 'क्या बोल सकता हूँ',
  ],
  back: ['back', 'go back', 'previous', 'previous screen', 'wapas', 'wapas jao', 'peeche', 'वापस', 'वापस जाओ', 'पीछे'],
  cancel: ['cancel', 'never mind', 'nevermind', 'forget it', 'leave it', 'rehne do', 'रहने दो'],
};

/** The agent's own command, when the whole utterance is one. */
export function matchMetaCommand(transcript: string): MetaCommand | undefined {
  const c = core(transcript);
  if (!c) return undefined;
  for (const [command, phrases] of Object.entries(META) as Array<[MetaCommand, string[]]>) {
    if (phrases.includes(c)) return command;
  }
  return undefined;
}

/** `change`: do not run it, but keep what was heard in the form so it can be edited (docs/03 §16.4 "Change details"). */
export type ConfirmAnswer = 'confirm' | 'cancel' | 'change' | 'unclear';

const NO_WORDS = new Set([
  'cancel', 'no', 'nope', 'nah', 'nahi', 'nahin', 'नहीं', 'नही', 'mat', 'मत', 'stop', 'dont', "don't", 'never',
  'abort', 'ruko', 'ruk', 'रुको', 'रुक', 'band', 'बंद', 'wait',
]);
const YES_WORDS = new Set([
  'confirm', 'confirmed', 'yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'sure', 'correct', 'proceed', 'haan', 'han', 'haa',
  'ha', 'हाँ', 'हां', 'हा', 'theek', 'thik', 'ठीक', 'sahi', 'सही',
]);
const CHANGE_WORDS = new Set(['change', 'edit', 'fix', 'badlo', 'badal', 'बदलो', 'बदल', 'sudharo', 'सुधारो']);
const YES_PHRASES = [['do', 'it'], ['go', 'ahead'], ['kar', 'do'], ['kardo'], ['ho', 'jaye'], ['कर', 'दो']];

/**
 * Reads the answer to a spoken "Say confirm or cancel". Safety first: any "no" word cancels, even
 * when a "yes" word is also present ("no, don't confirm").
 */
export function interpretConfirmation(transcript: string): ConfirmAnswer {
  const w = speechWords(transcript);
  if (w.some((x) => NO_WORDS.has(x))) return 'cancel';
  // "Change details" never runs the action, so it is safe to prefer over a stray "yes" ("yes, change it").
  if (w.some((x) => CHANGE_WORDS.has(x))) return 'change';
  if (w.some((x) => YES_WORDS.has(x))) return 'confirm';
  for (const phrase of YES_PHRASES) {
    for (let i = 0; i + phrase.length <= w.length; i++) {
      if (phrase.every((p, k) => w[i + k] === p)) return 'confirm';
    }
  }
  return 'unclear';
}
