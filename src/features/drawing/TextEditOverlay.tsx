/** In-place text editor shown over the canvas while the Text tool is editing (docs/08 §7.9). */
import { TextInput } from 'react-native';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { useKalamTheme } from '@/design';
import type { StudioState } from './studio-store';

export function TextEditOverlay({ store }: { store: StoreApi<StudioState> }) {
  const { colors } = useKalamTheme();
  const edit = useStore(store, (s) => s.textEdit);
  const view = useStore(store, (s) => s.view);
  if (!edit) return null;
  const size = edit.fontSize * view.scale;
  return (
    <TextInput
      autoFocus
      multiline
      value={edit.text}
      onChangeText={(t) => store.getState().updateTextEdit(t)}
      onBlur={() => store.getState().commitTextEdit()}
      onKeyPress={(e) => { if (e.nativeEvent.key === 'Escape') store.getState().commitTextEdit(); }}
      placeholder="Type a label"
      placeholderTextColor={colors.textMuted}
      accessibilityLabel="Text on the drawing"
      style={{
        position: 'absolute',
        left: view.tx + edit.x * view.scale - 4,
        top: view.ty + edit.y * view.scale - 4,
        minWidth: 160,
        padding: 4,
        fontSize: size,
        lineHeight: size * 1.25,
        color: edit.color,
        borderWidth: 1.5,
        borderColor: colors.focusRing,
        borderStyle: 'dashed',
        borderRadius: 4,
        backgroundColor: 'transparent',
        outlineStyle: 'none',
      } as object}
    />
  );
}
