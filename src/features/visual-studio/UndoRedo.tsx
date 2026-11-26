/**
 * Undo and redo for the editor's pending changes (docs/14 §4.2, docs/15 §7). Two icon buttons, plus
 * Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z (or Ctrl+Y) on the web. A text box keeps its own undo, so the
 * shortcut stays out of it. Pair with `useDraftHistory`.
 */
import { Redo2, Undo2 } from 'lucide-react-native';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { announce, IconButton, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

export interface UndoRedoProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  /** True while a save or an AI step is running. */
  disabled?: boolean;
}

export function UndoRedo({ canUndo, canRedo, onUndo, onRedo, disabled }: UndoRedoProps) {
  const t = useT(useKalamTheme().uiLanguage);
  const undo = () => { onUndo(); announce(t('visualStudio.history.undone')); };
  const redo = () => { onRedo(); announce(t('visualStudio.history.redone')); };

  useEffect(() => {
    if (Platform.OS !== 'web' || disabled) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey && canUndo) { e.preventDefault(); undo(); }
      else if (((key === 'z' && e.shiftKey) || key === 'y') && canRedo) { e.preventDefault(); redo(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUndo, canRedo, disabled, onUndo, onRedo, t]);

  return (
    <View accessibilityRole="toolbar" accessibilityLabel={t('visualStudio.history.label')} style={{ flexDirection: 'row', gap: 4 }}>
      <IconButton icon={Undo2} label={t('common.undo')} disabled={disabled || !canUndo} onPress={undo} />
      <IconButton icon={Redo2} label={t('common.redo')} disabled={disabled || !canRedo} onPress={redo} />
    </View>
  );
}
