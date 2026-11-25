/**
 * Right-to-left readiness (docs/10 §13.6). All ten shipped languages are left to right, so RTL is
 * PREPARED, NOT ENABLED: nothing here calls `I18nManager.allowRTL`, and `textDirection()` returns `ltr`
 * for every language Kalam ships.
 *
 * Use `toLogicalStyle` when writing or migrating styles so a layout means "start" and "end" instead of
 * "left" and "right". React Native maps `marginStart`, `paddingEnd`, `start` and friends to the correct
 * physical side when direction flips. Pure TypeScript.
 */
export { textDirection } from './languages';

/** Physical style keys and the logical key that replaces each one. */
export const LOGICAL_STYLE_KEYS: Readonly<Record<string, string>> = {
  marginLeft: 'marginStart',
  marginRight: 'marginEnd',
  paddingLeft: 'paddingStart',
  paddingRight: 'paddingEnd',
  left: 'start',
  right: 'end',
  borderLeftWidth: 'borderStartWidth',
  borderRightWidth: 'borderEndWidth',
  borderLeftColor: 'borderStartColor',
  borderRightColor: 'borderEndColor',
  borderTopLeftRadius: 'borderTopStartRadius',
  borderTopRightRadius: 'borderTopEndRadius',
  borderBottomLeftRadius: 'borderBottomStartRadius',
  borderBottomRightRadius: 'borderBottomEndRadius',
};

/**
 * Rewrites physical left/right style keys to logical start/end keys. `textAlign: 'left'` becomes `auto`,
 * which follows the text's own direction. Other keys pass through unchanged. Returns a new object.
 */
export function toLogicalStyle<T extends Record<string, unknown>>(style: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) {
    if (key === 'textAlign' && value === 'left') out.textAlign = 'auto';
    else out[LOGICAL_STYLE_KEYS[key] ?? key] = value;
  }
  return out;
}

/** Which side "start" is on for a direction. Use for web CSS, where physical sides are still needed. */
export function startSide(direction: 'ltr' | 'rtl'): 'left' | 'right' {
  return direction === 'rtl' ? 'right' : 'left';
}
