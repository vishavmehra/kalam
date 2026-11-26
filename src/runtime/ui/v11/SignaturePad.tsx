/**
 * Signature (KalamSpec 1.1). Draw with a finger or mouse; the strokes are saved into the bound text
 * field as numbers (engine/v11/signature.ts) and drawn back from those numbers only. Anyone who
 * cannot draw (keyboard, switch, screen reader, Voice-only) can type their name instead, which is
 * stored as a typed signature, so a required signature never blocks Save.
 */
import { Eraser, Keyboard, PenLine } from 'lucide-react-native';
import { memo, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, TextInput, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { RecordValue } from '@/core/contracts';
import type { ComponentOf } from '@/core/spec/schema';
import type { RuntimeTheme } from '../../engine/theme';
import type { FieldDef } from '../../engine/types';
import {
  decodeSignature, encodeSignature, encodeTypedSignature, signaturePath, toBox, typedSignature,
  type Point, type Stroke,
} from '../../engine/v11';
import { fieldBox, FieldShell, invalidProps } from '../inputs';
import { useV11Words } from '../../use-app-t';
import { font, Pressy } from '../kit';

export interface SignaturePadProps {
  c: ComponentOf<'signature'>;
  t: RuntimeTheme;
  def?: FieldDef;
  value: RecordValue | undefined;
  error?: string;
  onChange(value: RecordValue): void;
  onFocus(): void;
  /** Language of the words. Absent: the running app's own. */
  lang?: string;
}

export const SignaturePad = memo(function SignaturePad({ c, t, def, value, error, onChange, onFocus, lang }: SignaturePadProps) {
  const w = useV11Words(lang);
  const saved = useMemo(() => decodeSignature(value) ?? [], [value]);
  const typed = typedSignature(value);
  const [typing, setTyping] = useState(typed !== undefined);
  const [name, setName] = useState(typed ?? '');
  const [live, setLive] = useState<Point[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [tooLong, setTooLong] = useState(false);
  const liveRef = useRef<Point[]>([]);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const savedRef = useRef(saved);
  savedRef.current = saved;

  const at = (e: GestureResponderEvent): Point =>
    toBox(e.nativeEvent.locationX, e.nativeEvent.locationY, sizeRef.current.width, sizeRef.current.height);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // The page must not scroll away mid-signature.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          onFocus();
          liveRef.current = [at(e)];
          setLive(liveRef.current);
        },
        onPanResponderMove: (e) => {
          liveRef.current = [...liveRef.current, at(e)];
          setLive(liveRef.current);
        },
        onPanResponderRelease: () => {
          const strokes: Stroke[] = [...savedRef.current, liveRef.current];
          liveRef.current = [];
          setLive([]);
          const text = encodeSignature(strokes);
          setTooLong(!text);
          if (text) onChange(text);
        },
      }),
    // `at` reads refs only; the responder is made once per callback pair.
    [onChange, onFocus],
  );

  const signed = saved.length > 0 || typed !== undefined;
  const required = def?.required ?? c.required;
  const height = Math.round(Math.min(220, Math.max(120, size.width / 2.5)) * Math.min(t.fontScale, 1.3));
  const path = signaturePath(live.length ? [...saved, live] : saved, size.width, size.height);
  const id = `lbl_${c.id}`;
  const shownError = error ?? (tooLong ? w.signatureTooLong : undefined);
  const clear = () => {
    setTooLong(false);
    setName('');
    onChange(null);
  };
  const smallButton = (key: string, label: string, Icon: typeof Eraser, onPress: () => void, disabled = false) => (
    <Pressy
      key={key}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${c.label}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.small, { minHeight: t.target, paddingHorizontal: t.space * 0.75, opacity: disabled ? 0.5 : 1 }]}
    >
      <Icon size={18 * t.fontScale} color={t.colors.primaryText} />
      <Text style={[font(t, 15, '500'), { color: t.colors.primaryText }]}>{label}</Text>
    </Pressy>
  );
  const buttons = [
    typing
      ? smallButton('mode', w.drawInstead, PenLine, () => setTyping(false))
      : smallButton('mode', w.typeInstead, Keyboard, () => {
          onFocus();
          setTyping(true);
        }),
    smallButton('clear', w.clearSignature, Eraser, clear, !signed),
  ];
  return (
    <FieldShell t={t} componentId={c.id} label={c.label} required={required} error={shownError} nativeID={id}>
      {typing ? (
        <TextInput
          value={name}
          onChangeText={(text) => {
            setName(text);
            onChange(encodeTypedSignature(text) ?? null);
          }}
          onFocus={onFocus}
          placeholder={w.typeToSign}
          placeholderTextColor={t.colors.textMuted}
          accessibilityLabel={`${c.a11yLabel ?? c.label}. ${w.typeToSign}`}
          accessibilityHint={c.a11yDescription}
          {...invalidProps(id, shownError, required)}
          autoComplete="name"
          autoCorrect={false}
          maxLength={80}
          style={[fieldBox(t, false, shownError), font(t, 22, '500'), { color: t.colors.text, fontStyle: 'italic' }]}
        />
      ) : (
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={w.signatureA11y(c.a11yLabel ?? c.label, signed)}
          accessibilityHint={c.a11yDescription ?? w.signHere}
          {...invalidProps(id, shownError, required)}
          onLayout={(e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
          {...responder.panHandlers}
          style={[
            styles.pad,
            { height, borderRadius: Math.min(t.radius, 16), borderColor: shownError ? t.colors.danger : t.colors.border, borderWidth: Math.max(1, t.borderWidth), backgroundColor: t.colors.surface },
            { touchAction: 'none', cursor: 'crosshair' } as object,
          ]}
        >
          <View pointerEvents="none" style={styles.fill}>
            {path ? (
              <Svg width={size.width} height={size.height}>
                <Path d={path} stroke={t.colors.text} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            ) : typed !== undefined ? (
              <Text style={[font(t, 26, '500'), { color: t.colors.text, textAlign: 'center', fontStyle: 'italic' }]}>{typed}</Text>
            ) : (
              <Text style={[font(t, 15), { color: t.colors.textMuted, textAlign: 'center' }]}>{w.signHere}</Text>
            )}
          </View>
          <View pointerEvents="none" style={[styles.line, { borderColor: t.colors.border }]} />
        </View>
      )}
      <View style={[styles.row, { justifyContent: t.mirror ? 'flex-start' : 'flex-end' }]}>{t.mirror ? [...buttons].reverse() : buttons}</View>
    </FieldShell>
  );
});

const styles = StyleSheet.create({
  pad: { overflow: 'hidden', justifyContent: 'center' },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'center' },
  line: { position: 'absolute', left: 16, right: 16, bottom: 28, borderBottomWidth: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  small: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
