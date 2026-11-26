/**
 * In-place text editor shown over the canvas while the Text tool is editing (docs/08 §7.9). Typing shows
 * the right Noto font for Hindi, Tamil and the other Indic scripts, and a microphone button fills the text
 * by voice (docs/08 §18). Voice follows Kalam's speech rules: on-device recognition when the device has it,
 * the platform's online service only after the person agrees, and the recording is not kept.
 */
import { Mic, Square } from 'lucide-react-native';
import { useEffect, useRef, useSyncExternalStore, type ComponentRef } from 'react';
import { Platform, TextInput, View } from 'react-native';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { ConfirmSheet, IconButton, Text, useKalamTheme } from '@/design';
import { isScriptLoaded } from '@/i18n/use-script-fonts';
import { useDictation } from '@/features/editing/overlay/useDictation';
import { useSettingsStore } from '@/state/settings-store';
import { canvasFontStack, nonLatinScripts, textFontFamilies } from './model';
import type { StudioState } from './studio-store';
import { blurAction } from './text-edit-focus';
import { ensureTextFonts, subscribeTextFonts, textFontsVersion } from './text-fonts';

/** `fontFamily` for the text box: a CSS stack on the web, one registered family on Android, nothing for English. */
function boxFont(text: string): string | undefined {
  if (Platform.OS === 'web') return canvasFontStack(text, 'regular', 'Inter');
  const script = nonLatinScripts(text)[0];
  return script && isScriptLoaded(script) ? textFontFamilies(text)[0] : undefined;
}

export function TextEditOverlay({ store }: { store: StoreApi<StudioState> }) {
  const { colors, space, radius } = useKalamTheme();
  const edit = useStore(store, (s) => s.textEdit);
  const view = useStore(store, (s) => s.view);
  const language = useSettingsStore((s) => s.settings.speech?.sttLanguage) ?? 'en-IN';
  const dictation = useDictation(language, (t) => store.getState().updateTextEdit(t));
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  /** The microphone button was just pressed, so the box losing focus is not "done typing". */
  const holdFocus = useRef(false);
  /** The "use online speech?" sheet is open. It takes focus from the box, which must not end the edit. */
  const asking = useRef(false);
  asking.current = !!dictation.ask;
  useSyncExternalStore(subscribeTextFonts, textFontsVersion, textFontsVersion);
  const text = edit?.text ?? '';
  useEffect(() => { void ensureTextFonts(text); }, [text]);
  // Leaving the text box (or the page) ends listening.
  const stopListening = dictation.stop;
  useEffect(() => { if (!edit) stopListening(); }, [edit, stopListening]);
  // The edit ended while the question was open: that is a "no", so the waiting microphone press finishes.
  const ask = dictation.ask;
  useEffect(() => { if (!edit && ask) ask.answer(false); }, [edit, ask]);
  // Once the question is answered the box gets its focus back, after the sheet has finished closing.
  const wasAsking = useRef(false);
  useEffect(() => {
    if (ask) { wasAsking.current = true; return undefined; }
    if (!wasAsking.current) return undefined;
    wasAsking.current = false;
    const timer = setTimeout(() => input.current?.focus(), 320);
    return () => clearTimeout(timer);
  }, [ask]);

  const sheet = (
    <ConfirmSheet
      key="speech-consent"
      visible={!!ask}
      title="Use online speech?"
      message={ask?.message ?? ''}
      confirmLabel="Use it"
      onConfirm={() => ask?.answer(true)}
      onCancel={() => ask?.answer(false)}
    />
  );
  // The sheet is keyed so it keeps its place when the text box comes and goes around it.
  if (!edit) return <>{sheet}</>;

  const size = edit.fontSize * view.scale;
  const left = view.tx + edit.x * view.scale - 4;
  const top = view.ty + edit.y * view.scale - 4;
  const fontFamily = boxFont(edit.text);
  const mic = dictation.listening ? 'Stop listening' : 'Speak the text';

  return (
    <>
      <TextInput
        ref={input}
        autoFocus
        multiline
        value={edit.text}
        onChangeText={(t) => store.getState().updateTextEdit(t)}
        onBlur={() => {
          const action = blurAction({ holdFocus: holdFocus.current, asking: asking.current });
          if (action === 'wait') return;
          if (action === 'refocus') { holdFocus.current = false; input.current?.focus(); return; }
          store.getState().commitTextEdit();
        }}
        onKeyPress={(e) => { if (e.nativeEvent.key === 'Escape') store.getState().commitTextEdit(); }}
        placeholder="Type a label"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="Text on the drawing"
        style={{
          position: 'absolute',
          left,
          top,
          minWidth: 160,
          padding: 4,
          fontSize: size,
          lineHeight: size * 1.25,
          color: edit.color,
          ...(fontFamily ? { fontFamily } : {}),
          borderWidth: 1.5,
          borderColor: colors.focusRing,
          borderStyle: 'dashed',
          borderRadius: 4,
          backgroundColor: 'transparent',
          outlineStyle: 'none',
        } as object}
      />
      <View
        accessibilityLiveRegion="polite"
        // The press must not take focus from the text box, or the edit would end before the voice starts.
        onTouchStart={() => { holdFocus.current = true; }}
        {...(Platform.OS === 'web' ? ({ onMouseDown: (e: { preventDefault(): void }) => { holdFocus.current = true; e.preventDefault(); } } as object) : {})}
        style={{
          position: 'absolute', left: Math.max(4, left), top: Math.max(4, top - 56), flexDirection: 'row', alignItems: 'center', gap: space[2],
          paddingEnd: space[3], borderRadius: radius.lg, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border,
        }}
      >
        <IconButton
          icon={dictation.listening ? Square : Mic}
          label={mic}
          selected={dictation.listening}
          onPress={() => { void dictation.toggle(edit.text); holdFocus.current = false; input.current?.focus(); }}
        />
        <Text variant="caption" tone={dictation.error ? 'danger' : 'secondary'} style={{ maxWidth: 220 }}>
          {dictation.error ?? (dictation.listening ? 'Listening. Tap to stop.' : 'Speak the text')}
        </Text>
      </View>
      {sheet}
    </>
  );
}
