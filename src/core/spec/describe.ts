/**
 * Plain-language summary of a spec for the "Here's what I understood" review (docs/06, docs/07 §11).
 * Written for non-technical users: labels and titles only, never raw ids in sentences.
 */
import type { UnderstandingSummary } from '../contracts';
import type { KalamAction, KalamAIBlock, KalamComponent, KalamField, KalamSpec } from './schema';

const LANGUAGES: Record<string, string> = {
  en: 'English', hi: 'Hindi', bn: 'Bengali', ta: 'Tamil', te: 'Telugu', mr: 'Marathi', gu: 'Gujarati',
  kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi', ur: 'Urdu', or: 'Odia', as: 'Assamese', ne: 'Nepali',
  es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', ar: 'Arabic', sw: 'Swahili', id: 'Indonesian',
  zh: 'Chinese', ja: 'Japanese',
};
export const languageName = (code: string): string => LANGUAGES[code.split('-')[0] ?? code] ?? code;

/** `due_date` → `Due date` (fallback when a label is missing). */
const humanize = (id: string): string => {
  const s = id.replace(/_+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const lower = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const singular = (s: string): string => {
  if (/ies$/i.test(s)) return s.replace(/ies$/i, 'y');
  if (/(ss|us|is)$/i.test(s)) return s;
  return s.replace(/s$/i, '');
};
const quote = (s: string): string => `“${s}”`;

function describeField(f: KalamField): string {
  switch (f.type) {
    case 'text': return f.multiline ? 'Long text' : 'Text';
    case 'number': return f.unit ? `Number (${f.unit})` : 'Number';
    case 'date': return 'Date';
    case 'boolean': return 'Yes / No';
    case 'enum': return `One of: ${f.options.join(', ')}`;
  }
}

export function describeSpec(spec: KalamSpec): UnderstandingSummary {
  const collectionName = (id: string): string => spec.collections[id]?.label || humanize(id);
  const recordName = (id: string): string => lower(singular(collectionName(id)));
  const screenTitle = (id: string): string => spec.screens.find((s) => s.id === id)?.title ?? humanize(id);
  const componentLabel = (id: string): string | undefined => {
    for (const s of spec.screens) {
      const c = s.children.find((x) => x.id === id);
      if (c) return ('label' in c && c.label) || undefined;
    }
    return undefined;
  };
  const fieldLabel = (id: string): string => {
    for (const c of Object.values(spec.collections)) {
      const f = c.fields[id];
      if (f) return f.label;
    }
    return componentLabel(id) ?? humanize(id);
  };

  const describeComponent = (c: KalamComponent): string => {
    const hidden = c.visible === false ? ' (hidden)' : '';
    switch (c.type) {
      case 'text': return `Text: ${c.label}${hidden}`;
      case 'heading': return `Heading: ${c.label}${hidden}`;
      case 'number': return `Number box: ${c.label}${hidden}`;
      case 'textInput': return `Text box: ${c.label}${hidden}`;
      case 'date': return `Date picker: ${c.label}${hidden}`;
      case 'choice': return `Choice: ${c.label}${c.options ? ` (${c.options.join(', ')})` : ''}${hidden}`;
      case 'toggle': return `Switch: ${c.label}${hidden}`;
      case 'counter': return `Counter: ${c.label}${hidden}`;
      case 'bigButton': return `Button: ${c.label}${hidden}`;
      case 'list': return `List of ${lower(c.label || collectionName(c.source))}${c.toggleField ? ' with tick boxes' : ''}${hidden}`;
      case 'stat': return `Summary: ${c.label}${hidden}`;
      case 'photo': return `Photo: ${c.label}${c.aiBlock ? ' (read by AI)' : ''}${hidden}`;
    }
  };

  const describeAction = (a: KalamAction): string => {
    const then = (sentence: string): string => {
      if (!('then' in a) || !a.then) return sentence;
      const parts = [sentence];
      if (a.then.navigate) parts.push(`returns to ${screenTitle(a.then.navigate)}`);
      if (a.then.speak) parts.push(`says ${quote(a.then.speak)}`);
      else if (a.then.feedback) parts.push(`shows ${quote(a.then.feedback)}`);
      return parts.length > 2 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts.join(' and ');
    };
    const target = (id: string): string => lower(componentLabel(id) ?? fieldLabel(id));
    switch (a.type) {
      case 'navigate': return `Opens ${screenTitle(a.screen)}`;
      case 'insert': return then(`Saves a new ${recordName(a.collection)}`);
      case 'update': return then(`Updates the chosen ${recordName(a.collection)}`);
      case 'delete': return then(`Deletes the chosen ${recordName(a.collection)} after asking ${quote(a.confirm)}`);
      case 'increment': return `Adds ${a.by ?? 1} to ${target(a.target)}`;
      case 'decrement': return `Takes ${a.by ?? 1} away from ${target(a.target)}`;
      case 'reset': return `Resets ${target(a.target)}`;
      case 'runAI': {
        const block = spec.aiBlocks[a.aiBlock];
        return then(block ? `${describeBlock(block)} using AI` : 'Uses AI');
      }
      case 'speak': return `Reads ${quote(a.text)} aloud`;
      case 'feedback': return `Shows the message ${quote(a.message)}`;
      case 'clearForm': return 'Clears the form';
    }
  };

  const describeBlock = (b: KalamAIBlock): string => {
    switch (b.kind) {
      case 'extractFromPhoto': {
        const fields = b.fields ?? Object.keys(spec.collections[b.target]?.fields ?? {});
        return `Reads a photo and fills in ${fields.map((f) => lower(spec.collections[b.target]?.fields[f]?.label ?? humanize(f))).join(', ')}`;
      }
      case 'classify': return `Sorts ${lower(fieldLabel(b.inputField))} into ${b.labels.join(', ')}`;
      case 'summarise': return `Summarises ${lower(fieldLabel(b.inputField))} in up to ${b.maxWords} words`;
      case 'translate': return `Translates ${lower(fieldLabel(b.inputField))} into ${languageName(b.targetLang)}`;
    }
  };
  const verifiedText = { onDevice: 'Works on this device, even offline', cloudPreferred: 'Works best when online', unverified: 'Not checked yet' } as const;

  const assumptions: string[] = [];
  const currencies = new Set<string>();
  const units: string[] = [];
  for (const s of spec.screens) {
    for (const c of s.children) if (c.type === 'stat' && c.format === 'currency') currencies.add(c.currency ?? 'INR');
  }
  for (const col of Object.values(spec.collections)) {
    for (const f of Object.values(col.fields)) {
      if (f.type === 'number' && f.unit && !units.includes(`${f.label} (${f.unit})`)) units.push(`${f.label} (${f.unit})`);
    }
  }
  if (currencies.size) assumptions.push(`Currency set to ${[...currencies].join(', ')}`);
  if (units.length) assumptions.push(`Units: ${units.slice(0, 4).join(', ')}`);
  if (!spec.lang.startsWith('en')) assumptions.push(`Language: ${languageName(spec.lang)}`);
  assumptions.push(`Opens on ${screenTitle(spec.initialScreen)}`);
  if (Object.keys(spec.collections).length) assumptions.push('Your entries are saved on this device and work offline');
  if (Object.values(spec.aiBlocks).some((b) => b.verified === 'unverified')) {
    assumptions.push('AI features will be checked on your device before they run offline');
  }

  const purpose = spec.description || spec.meta.description
    || (Object.keys(spec.collections).length
      ? `Keeps track of ${Object.keys(spec.collections).map((id) => lower(collectionName(id))).join(' and ')}`
      : `A simple ${spec.name} app`);

  // One sentence per action that a person can actually trigger (buttons and voice), in screen order.
  const triggered: string[] = [];
  for (const s of spec.screens) for (const c of s.children) if (c.type === 'bigButton') triggered.push(c.action);
  triggered.push(...Object.keys(spec.intents));
  const actions = [...new Set(triggered)]
    .map((id) => spec.actions[id])
    .filter((a): a is KalamAction => !!a)
    .map(describeAction);

  return {
    appName: spec.name,
    purpose,
    screens: spec.screens.map((s) => ({ id: s.id, title: s.title, items: s.children.map(describeComponent) })),
    collections: Object.entries(spec.collections).map(([id, c]) => ({
      id,
      name: collectionName(id),
      fields: Object.values(c.fields).map((f) => ({ label: f.label, type: describeField(f), required: !!f.required })),
    })),
    actions: [...new Set(actions)],
    aiFeatures: Object.entries(spec.aiBlocks).map(([id, b]) => ({
      id, kind: b.kind, description: describeBlock(b), verified: verifiedText[b.verified],
    })),
    assumptions,
  };
}
