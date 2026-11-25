/**
 * Explicit pointer states (docs/08 §8.2). The Studio store keeps one `gesture` (or `textEdit`) at a time;
 * this names the state that implies and lists which moves between states are legal. The web and Android
 * canvases still translate their own input, but pan and pinch now live in the store like every other
 * gesture, so the whole machine can be tested without a canvas.
 */
export type PointerState = 'idle' | 'pointer_down' | 'drawing' | 'selecting' | 'transforming' | 'panning' | 'text_editing';

export interface PointerInput {
  gesture?: { kind: 'draw' | 'erase' | 'shape' | 'move' | 'resize' | 'rotate' | 'marquee' | 'pan' | 'pinch' };
  textEdit?: unknown;
  /** A move, resize or turn has started changing something. */
  preview?: unknown;
  /** The selection rectangle has been dragged out. */
  marquee?: unknown;
}

export function pointerStateOf(s: PointerInput): PointerState {
  const g = s.gesture;
  if (!g) return s.textEdit ? 'text_editing' : 'idle';
  switch (g.kind) {
    case 'draw': case 'erase': case 'shape': return 'drawing';
    case 'pan': case 'pinch': return 'panning';
    case 'marquee': return s.marquee ? 'selecting' : 'pointer_down';
    case 'move': case 'resize': case 'rotate': return s.preview ? 'transforming' : 'pointer_down';
  }
}

/** Legal next states. A second finger can always interrupt a gesture and turn it into a pan or zoom. */
export const POINTER_TRANSITIONS: Readonly<Record<PointerState, readonly PointerState[]>> = {
  idle: ['pointer_down', 'drawing', 'panning', 'text_editing'],
  pointer_down: ['idle', 'drawing', 'selecting', 'transforming', 'panning'],
  drawing: ['idle', 'panning'],
  selecting: ['idle', 'panning'],
  transforming: ['idle', 'panning'],
  panning: ['idle'],
  text_editing: ['idle', 'pointer_down', 'drawing', 'panning'],
};

export function canTransition(from: PointerState, to: PointerState): boolean {
  return from === to || POINTER_TRANSITIONS[from].includes(to);
}
