/**
 * Text expectations for the on-device model (Chrome Prompt API shape, also used by the Android adapter).
 * Chrome documents English, Spanish and Japanese for Prompt API text input and output; declaring any
 * other language makes the model report itself unavailable, so only those are declared. English is
 * always declared because Kalam's instructions are written in English. Other languages are not claimed
 * for Gemini Nano until they are tested (docs/17 §7.6). The Android adapter checks its own list.
 */
import type { LanguageModelCreateCoreOptions } from 'firebase/ai';

export const PROMPT_API_LANGUAGES: readonly string[] = ['en', 'es', 'ja'];

/** `languages` are BCP-47 tags or primary subtags (`StructuredRequest.languages`); absent means English. */
export function textIO(languages: readonly string[] = []): LanguageModelCreateCoreOptions {
  const wanted = new Set(languages.map((l) => l.trim().toLowerCase().split(/[-_]/)[0]));
  const langs = PROMPT_API_LANGUAGES.filter((l) => l === 'en' || wanted.has(l));
  return {
    expectedInputs: [{ type: 'text', languages: langs }],
    expectedOutputs: [{ type: 'text', languages: langs }],
  };
}
