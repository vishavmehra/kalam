import { CircleAlert } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Platform, View, type TextStyle, type ViewStyle } from 'react-native';

import type { TFunction } from '@/i18n/translator';

import { Text } from '../Text';
import type { KalamTheme } from '../theme';
import { fontFamily } from '../typography';
import type { DateError, NumberError } from './logic';

/** Box around a control, the same as TextField: ruled edge, sindoor on focus, danger on error. */
export function frameStyle(theme: KalamTheme, o: { focused?: boolean; error?: boolean; disabled?: boolean }): ViewStyle {
  const c = theme.colors;
  const thick = !!o.focused || !!o.error;
  return {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: theme.touchTarget,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: thick ? 2 : 1.5,
    // Keep content from shifting when the border thickens.
    margin: thick ? 0 : 0.5,
    borderColor: o.focused ? c.focusRing : o.error ? c.danger : c.borderStrong,
    backgroundColor: c.surfaceElevated,
    opacity: o.disabled ? 0.5 : 1,
  };
}

/** Type for the text inside a framed control. */
export function inputTextStyle(theme: KalamTheme): TextStyle {
  return {
    flex: 1,
    alignSelf: 'stretch',
    fontFamily: fontFamily('regular', false, theme.script),
    fontSize: Math.round(16 * theme.fontScale),
    color: theme.colors.text,
    // RN-web: the frame carries the focus ring, not the input.
    outlineStyle: 'none',
  } as unknown as TextStyle;
}

/** Error (icon and words, never colour alone) or helper line under a control. */
export function FieldMessage({ id, helper, error, theme }: { id: string; helper?: string; error?: string; theme: KalamTheme }) {
  if (error) {
    return (
      <View nativeID={id} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <CircleAlert size={14} color={theme.colors.danger} />
        <Text variant="bodySmall" tone="danger">{error}</Text>
      </View>
    );
  }
  return helper ? <Text nativeID={id} variant="bodySmall" tone="muted">{helper}</Text> : null;
}

/** Label above, control, then the message. `id` ties the label (`${id}-label`) and message (`${id}-desc`) to the control. */
export function FieldShell({ id, label, labelHidden, helper, error, theme, children }: {
  id: string; label: string; labelHidden?: boolean; helper?: string; error?: string; theme: KalamTheme; children: ReactNode;
}) {
  return (
    <View style={{ gap: 6, alignSelf: 'stretch' }}>
      {labelHidden ? null : <Text variant="bodySmall" weight="medium" tone="secondary" nativeID={`${id}-label`}>{label}</Text>}
      {children}
      <FieldMessage id={`${id}-desc`} helper={helper} error={error} theme={theme} />
    </View>
  );
}

/**
 * Space activates a checkbox, radio, switch or tab on the web. react-native-web only maps Enter for those roles
 * (Space is limited to buttons), so spread this next to `onPress`. `{}` on native.
 */
export function spaceToggles(onActivate: () => void): object {
  if (Platform.OS !== 'web') return {};
  return {
    onKeyDown: (e: { key: string; repeat?: boolean; preventDefault(): void }) => {
      if (e.key !== ' ') return;
      e.preventDefault(); // no page scroll
      if (!e.repeat) onActivate();
    },
  };
}

export function numberMessage(tr: TFunction, reason: NumberError, rules: { min?: number; max?: number }): string {
  if (reason === 'min') return tr('inputs.number.min', { min: rules.min });
  if (reason === 'max') return tr('inputs.number.max', { max: rules.max });
  return tr('inputs.number.invalid');
}

export function dateMessage(tr: TFunction, reason: DateError, rules: { min?: string; max?: string }): string {
  if (reason === 'min') return tr('inputs.date.min', { min: rules.min });
  if (reason === 'max') return tr('inputs.date.max', { max: rules.max });
  return tr('inputs.date.invalid');
}
