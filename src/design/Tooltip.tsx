import { cloneElement, type ReactElement, useEffect, useId, useRef, useState } from 'react';
import { Platform, type StyleProp, View, type ViewStyle } from 'react-native';

import { Text } from './Text';
import { useKalamTheme } from './theme';

export interface TooltipProps {
  /** Short text. Keep it to a few words; it is a hint, not a place for required information. */
  label: string;
  /** One element: the control the hint belongs to. It must already have its own accessible name. */
  children: ReactElement;
  placement?: 'top' | 'bottom';
  /** Style of the wrapper (default: shrinks to the control). */
  style?: StyleProp<ViewStyle>;
}

/**
 * Hover and keyboard-focus hint (WCAG 1.4.13): appears after a short hover or at once on focus, stays while the
 * pointer is over the control or the hint, and Escape dismisses it. Touch screens have no hover, so on Android and
 * iOS this renders the control unchanged; the control's own accessible name is what screen readers use.
 * ponytail: the hint sits next to its control and is not repositioned at screen edges or out of clipped parents.
 */
export function Tooltip(props: TooltipProps) {
  return Platform.OS === 'web' ? <WebTooltip {...props} /> : props.children;
}

function WebTooltip({ label, children, placement = 'top', style }: TooltipProps) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = (delayMs: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delayMs);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const events = {
    onMouseEnter: () => show(450),
    onMouseLeave: hide,
    onFocus: () => show(0),
    onBlur: hide,
    onKeyDown: (e: { key: string }) => { if (e.key === 'Escape') hide(); },
  };
  const below = placement === 'bottom';
  return (
    <View {...(events as object)} style={[{ position: 'relative', alignSelf: 'flex-start' }, style]}>
      {cloneElement(children, { 'aria-describedby': id } as object)}
      {open ? (
        // The padding bridges the gap to the control so the pointer can travel onto the hint without closing it.
        <View
          style={{
            position: 'absolute', zIndex: 50, start: '50%', transform: [{ translateX: '-50%' }],
            ...(below ? { top: '100%', paddingTop: 6 } : { bottom: '100%', paddingBottom: 6 }),
            width: 'max-content', maxWidth: 260,
          } as object}
        >
          <View
            role="tooltip"
            nativeID={id}
            style={{ backgroundColor: c.text, borderRadius: theme.radius.sm, paddingVertical: 6, paddingHorizontal: 10 }}
          >
            <Text variant="caption" style={{ color: c.background }}>{label}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
