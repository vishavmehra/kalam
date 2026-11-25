/**
 * Which languages the on-device model can really read and write (docs/10 §15.3: "the capability registry
 * must determine actual support"; docs/17 §7.6: claim nothing for Gemini Nano until it is tested).
 *
 * The baseline is what the provider already asks the Prompt API for (English, `TEXT_IO`). A probe may add
 * languages by asking the browser itself, one language at a time. No probe means English only, so every real
 * translation goes to Firebase cloud. Pure TypeScript: the probe is injected.
 */
import { baseLang, ON_DEVICE_TRANSLATION_LANGUAGES } from './languages';

/** Resolves true when the on-device model can read AND write this language. Never throws. */
export type LanguageProbe = (lang: string) => Promise<boolean>;

export interface DeviceLanguageRegistry {
  supports(lang: string): Promise<boolean>;
  /** Both languages supported and different: a translation can run on the device. */
  supportsPair(source: string, target: string): Promise<boolean>;
}

export function createDeviceLanguageRegistry(
  opts: { baseline?: readonly string[]; probe?: LanguageProbe } = {},
): DeviceLanguageRegistry {
  const baseline = new Set((opts.baseline ?? ON_DEVICE_TRANSLATION_LANGUAGES).map(baseLang));
  const probed = new Map<string, Promise<boolean>>();
  const supports = async (tag: string): Promise<boolean> => {
    const lang = baseLang(tag);
    if (!lang) return false;
    if (baseline.has(lang)) return true;
    if (!opts.probe) return false;
    let answer = probed.get(lang);
    if (!answer) {
      // One question per language per session: the answer does not change until the browser updates.
      answer = opts.probe(lang).catch(() => false);
      probed.set(lang, answer);
    }
    return answer;
  };
  return {
    supports,
    async supportsPair(source, target) {
      const a = baseLang(source);
      const b = baseLang(target);
      return !!a && !!b && a !== b && (await supports(a)) && (await supports(b));
    },
  };
}

/** The part of Chrome's `LanguageModel` that the probe uses. */
interface PromptApiLike {
  availability(options: {
    expectedInputs: Array<{ type: 'text'; languages: string[] }>;
    expectedOutputs: Array<{ type: 'text'; languages: string[] }>;
  }): Promise<string>;
}

/**
 * Probe for Chrome's Prompt API: a language counts only when the browser reports the model `available`
 * for that language as both input and output. `getModel` defaults to `globalThis.LanguageModel`.
 * Note: the provider must also pass the language to the model (`StructuredRequest.languages`) for the
 * answer to matter, so wire this probe together with that support.
 */
export function promptApiProbe(
  getModel: () => PromptApiLike | undefined = () => (globalThis as { LanguageModel?: PromptApiLike }).LanguageModel,
): LanguageProbe {
  return async (lang) => {
    try {
      const model = getModel();
      if (!model) return false;
      const io = [{ type: 'text' as const, languages: [lang] }];
      return (await model.availability({ expectedInputs: io, expectedOutputs: io })) === 'available';
    } catch {
      return false;
    }
  };
}
