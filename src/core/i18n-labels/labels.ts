/**
 * Translatable labels of a KalamSpec and the display-only translated view (docs/05 §11.3, docs/10 §14,
 * docs/09 §12.3). The canonical spec is never changed: a translated view is a separate copy for rendering.
 *
 * What is translated: screen titles and descriptions, component labels, hints, empty messages, read-aloud
 * and accessibility text, stat prefix and suffix, field and collection labels, enum option names (display
 * only), and the speak, feedback and confirm texts of actions.
 * What is never translated: ids, formulas, action wiring, intents, units, stored records, the app name.
 * Enum option VALUES stay canonical so stored records stay valid; only their display names are mapped.
 *
 * Pure TypeScript: runs in Node and in the runtime.
 */
import type { KalamComponent, KalamSpec } from '../spec/schema';

export type LabelKind =
  | 'screen_title' | 'screen_description' | 'label' | 'placeholder' | 'empty_text' | 'read_aloud'
  | 'a11y_label' | 'a11y_description' | 'prefix' | 'suffix' | 'field_label' | 'field_placeholder'
  | 'collection_label' | 'option' | 'speak' | 'feedback' | 'confirm';

export interface TranslatableLabel {
  /** Stable, human-readable key such as `bigButton.save_order.label` or `screen.home.title`. */
  key: string;
  /** The label as written in the app's own language. */
  text: string;
  kind: LabelKind;
  /** Where it shows, in plain words, for the review list: "Button", "Screen title". */
  where: string;
}

/** Bump when key naming or collection rules change, so old cached translations are not reused. */
export const TRANSLATION_ENGINE_VERSION = 'tr1';

const COMPONENT_WHERE: Record<KalamComponent['type'], string> = {
  text: 'Text', heading: 'Heading', number: 'Number box', textInput: 'Text box', date: 'Date box',
  choice: 'Choice', toggle: 'Switch', counter: 'Counter', bigButton: 'Button', list: 'List', stat: 'Figure',
  photo: 'Photo',
};

/** Component properties that hold display text: [property, kind, suffix for the "where" note]. */
const COMPONENT_TEXT: ReadonlyArray<readonly [string, LabelKind, string]> = [
  ['label', 'label', ''],
  ['placeholder', 'placeholder', ' hint'],
  ['emptyText', 'empty_text', ' empty message'],
  ['readAloud', 'read_aloud', ' spoken text'],
  ['a11yLabel', 'a11y_label', ' screen reader name'],
  ['a11yDescription', 'a11y_description', ' screen reader description'],
  ['prefix', 'prefix', ' prefix'],
  ['suffix', 'suffix', ' suffix'],
];

const hasLetters = (s: string): boolean => /\p{L}/u.test(s);

interface Visitor {
  /** Called once per translatable text; the return value replaces it (options are never replaced). */
  text(key: string, text: string, kind: LabelKind, where: string): string;
}

/**
 * The one traversal that defines which text is translatable and what its key is. It edits `spec` in place,
 * so callers pass a copy when they want a view. Texts without any letter (numbers, symbols) are skipped.
 */
function walk(spec: KalamSpec, visitor: Visitor): void {
  const used = new Set<string>();
  const uniqueKey = (key: string): string => {
    let k = key;
    // Only an invalid spec (a repeated id) can collide; keep the keys unique anyway.
    for (let n = 2; used.has(k); n++) k = `${key}~${n}`;
    used.add(k);
    return k;
  };
  const set = (obj: Record<string, unknown>, prop: string, key: string, kind: LabelKind, where: string): void => {
    const current = obj[prop];
    if (typeof current !== 'string' || !current.trim() || !hasLetters(current)) return;
    const next = visitor.text(uniqueKey(key), current, kind, where);
    if (next !== current) obj[prop] = next;
  };

  const optionKeys = new Map<string, string>();
  const option = (canonical: string): void => {
    if (optionKeys.has(canonical) || !canonical.trim() || !hasLetters(canonical)) return;
    const key = `option.${optionKeys.size + 1}`;
    optionKeys.set(canonical, key);
    used.add(key);
    // The returned text is ignored on purpose: option VALUES stay canonical, only their display name varies.
    visitor.text(key, canonical, 'option', 'Choice option');
  };

  for (const screen of spec.screens) {
    const s = screen as Record<string, unknown>;
    set(s, 'title', `screen.${screen.id}.title`, 'screen_title', 'Screen title');
    set(s, 'description', `screen.${screen.id}.description`, 'screen_description', 'Screen description');
    for (const component of screen.children) {
      const c = component as Record<string, unknown>;
      for (const [prop, kind, suffix] of COMPONENT_TEXT) {
        set(c, prop, `${component.type}.${component.id}.${prop}`, kind, `${COMPONENT_WHERE[component.type]}${suffix}`);
      }
      if (component.type === 'choice') component.options?.forEach(option);
    }
  }

  for (const [collectionId, collection] of Object.entries(spec.collections)) {
    set(collection as Record<string, unknown>, 'label', `collection.${collectionId}.label`, 'collection_label', 'Collection name');
    for (const [fieldId, field] of Object.entries(collection.fields)) {
      const f = field as Record<string, unknown>;
      set(f, 'label', `field.${collectionId}.${fieldId}.label`, 'field_label', 'Field label');
      if (field.type === 'text') set(f, 'placeholder', `field.${collectionId}.${fieldId}.placeholder`, 'field_placeholder', 'Field hint');
      if (field.type === 'enum') field.options.forEach(option);
    }
  }

  for (const [actionId, action] of Object.entries(spec.actions)) {
    const a = action as Record<string, unknown>;
    if (action.type === 'speak') set(a, 'text', `action.${actionId}.text`, 'speak', 'Spoken message');
    if (action.type === 'feedback') set(a, 'message', `action.${actionId}.message`, 'feedback', 'Message');
    if (action.type === 'delete') set(a, 'confirm', `action.${actionId}.confirm`, 'confirm', 'Delete question');
    if ('then' in action && action.then) {
      const then = action.then as Record<string, unknown>;
      set(then, 'speak', `action.${actionId}.then.speak`, 'speak', 'Spoken message');
      set(then, 'feedback', `action.${actionId}.then.feedback`, 'feedback', 'Message after the action');
    }
  }
}

/** Every translatable label of the spec, in screen order, with stable keys. */
export function collectTranslatableLabels(spec: KalamSpec): TranslatableLabel[] {
  const out: TranslatableLabel[] = [];
  walk(spec, {
    text(key, text, kind, where) {
      out.push({ key, text, kind, where });
      return text;
    },
  });
  return out;
}

/** 53-bit string hash (cyrb53). Not for security: it only detects that label text changed. */
function hash53(input: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Identifies the label set. A cached translation is reused only while this value is unchanged. */
export function sourceHash(labels: readonly TranslatableLabel[]): string {
  const lines = labels.map((l) => `${l.key}\u0001${l.text}`).sort();
  return `${TRANSLATION_ENGINE_VERSION}-${labels.length}-${hash53(lines.join('\n')).toString(16)}`;
}

export interface TranslatedView {
  /** A copy of the spec with display text replaced. Not for saving: the canonical spec is untouched. */
  spec: KalamSpec;
  /** Canonical enum option value to its translated display name. Stored values never change. */
  optionLabels: Readonly<Record<string, string>>;
}

const pick = (strings: Readonly<Record<string, string>>, key: string): string | undefined => {
  if (!Object.prototype.hasOwnProperty.call(strings, key)) return undefined;
  const value = strings[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
};

/**
 * Display-only translated copy of `spec`. Keys missing from `strings` keep their original text, so a
 * partial translation never produces an empty label. `lang`, when given, replaces `spec.lang` in the copy so
 * read-aloud picks a voice for the translated language.
 */
export function translatedView(spec: KalamSpec, strings: Readonly<Record<string, string>>, lang?: string): TranslatedView {
  // KalamSpec is plain JSON, so a JSON round trip is a complete deep copy.
  const draft = JSON.parse(JSON.stringify(spec)) as KalamSpec;
  const optionLabels: Record<string, string> = {};
  walk(draft, {
    text(key, text, kind) {
      const translated = pick(strings, key);
      if (kind === 'option') {
        if (translated) optionLabels[text] = translated;
        return text;
      }
      return translated ?? text;
    },
  });
  if (lang) draft.lang = lang;
  return { spec: draft, optionLabels };
}

/** Same as `translatedView(...).spec`. */
export function applyTranslatedView(spec: KalamSpec, strings: Readonly<Record<string, string>>, lang?: string): KalamSpec {
  return translatedView(spec, strings, lang).spec;
}
