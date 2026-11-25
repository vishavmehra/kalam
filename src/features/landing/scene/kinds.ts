import type { InputModality } from '@/core/contracts';

/** The five ways into Kalam, as the 3D stage names them. */
export type FragmentKind = 'text' | 'voice' | 'video' | 'photo' | 'drawing';

const FROM_MODALITY: Record<InputModality, FragmentKind> = {
  text: 'text', image: 'photo', audio: 'voice', video: 'video', drawing: 'drawing',
};

/** Pipeline modalities → stage fragments, in a stable order, never empty. */
export function fragmentKinds(modalities: readonly InputModality[]): FragmentKind[] {
  const kinds = modalities.map((m) => FROM_MODALITY[m]).filter((k): k is FragmentKind => !!k);
  return kinds.length ? Array.from(new Set(kinds)) : ['text'];
}
