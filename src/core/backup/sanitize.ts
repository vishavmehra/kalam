/**
 * Imported specs are untrusted (docs/11 §13.2, SECURITY_REVIEW R-09). A file can claim that an AI
 * block was verified on this device or that a cloud model produced the app; those claims change the
 * UI badge and the runtime's offline guard. On import every claim is reset before the final check.
 */
import type { KalamAIBlock, KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';

export const IMPORT_GENERATOR = { route: 'deterministic', provider: 'import' } as const;

/** Every AI block becomes unverified, verification evidence is dropped, provenance says "import". */
export function stripImportedClaims(spec: KalamSpec): KalamSpec {
  const aiBlocks: Record<string, KalamAIBlock> = {};
  for (const [id, block] of Object.entries(spec.aiBlocks)) {
    const { verification: _dropped, ...rest } = block;
    aiBlocks[id] = { ...rest, verified: 'unverified' } as KalamAIBlock;
  }
  return { ...spec, aiBlocks, meta: { ...spec.meta, generator: { ...IMPORT_GENERATOR } } };
}

/** validateSpec → reset claims → validateSpec again. Undefined when the design is not valid. */
export function validateImportedSpec(raw: unknown): KalamSpec | undefined {
  const first = validateSpec(raw);
  if (!first.ok || !first.spec) return undefined;
  const final = validateSpec(stripImportedClaims(first.spec));
  return final.ok ? final.spec : undefined;
}
