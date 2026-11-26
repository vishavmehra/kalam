/**
 * The docked panel under the drawing layer. It says what Kalam understood from the marks, takes
 * the person's words, and shows the proposed change with Keep / Discard. Copy is plain on purpose:
 * this is read by shopkeepers, not designers.
 */
import { Check, Eye, Mic, Square, TriangleAlert } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInUp, FadeOut } from 'react-native-reanimated';
import { Button, Chip, IconButton, SourceBadge, Text, TextField, useKalamTheme, type ExecutionSource } from '@/design';
import { useT } from '@/i18n/react';

export interface PanelMessage { text: string; tone: 'danger' | 'muted' }
export interface PanelChip { key: string; label: string; onPress(): void }

export type PanelView =
  | { stage: 'hint'; message?: PanelMessage }
  | {
    stage: 'picked'; title: string; chips: PanelChip[]; words: string; inputLabel: string; placeholder: string;
    busy: boolean; message?: PanelMessage; autoFocus: boolean;
    /** Shown under the field while offline. */
    offline: boolean;
    mic: { listening: boolean; onPress(): void };
  }
  | { stage: 'waiting'; title: string; message?: PanelMessage; alternative?: PanelChip }
  | { stage: 'working' }
  | {
    stage: 'proposed'; summary: string; notes: string[]; warnings: string[]; source: ExecutionSource;
    saving: boolean; alternative?: PanelChip; message?: PanelMessage;
  };

export function MarkPanel({ view, leftHanded, reduced, onWords, onSubmit, onCancel, onKeep, onDiscard, onPeek, onPick }: {
  view: PanelView;
  leftHanded: boolean;
  reduced: boolean;
  onWords(text: string): void;
  onSubmit(): void;
  onCancel(): void;
  onKeep(): void;
  onDiscard(): void;
  onPeek(showing: boolean): void;
  onPick(): void;
}) {
  const { colors, radius, space, elevation, uiLanguage } = useKalamTheme();
  const t = useT(uiLanguage);

  const message = (m?: PanelMessage) =>
    m ? <Text variant="bodySmall" tone={m.tone === 'danger' ? 'danger' : 'muted'}>{m.text}</Text> : null;

  const body = (() => {
    switch (view.stage) {
      case 'hint':
        return (
          <>
            <Text variant="h3" display>{t('edit.draw.hint.title')}</Text>
            <Text tone="secondary">{t('edit.draw.hint.body')}</Text>
            {message(view.message)}
            <View style={styles.row}>
              <Button label={t('edit.draw.pickFromList')} variant="link" onPress={onPick} />
            </View>
          </>
        );
      case 'picked':
        return (
          <>
            <Text variant="h4">{view.title}</Text>
            {view.chips.length ? (
              <View style={[styles.wrap, { gap: space[2] }]}>
                {view.chips.map((c) => <Chip key={c.key} label={c.label} onPress={view.busy ? undefined : c.onPress} />)}
              </View>
            ) : null}
            <TextField
              label={view.inputLabel}
              value={view.words}
              onChangeText={onWords}
              placeholder={view.placeholder}
              editable={!view.busy && !view.mic.listening}
              autoFocus={view.autoFocus}
              returnKeyType="done"
              onSubmitEditing={onSubmit}
              helper={view.offline ? t('edit.offlineHelper') : undefined}
            />
            {message(view.message)}
            <View style={[styles.row, { gap: space[2], justifyContent: leftHanded ? 'flex-start' : 'flex-end' }]}>
              <IconButton
                icon={view.mic.listening ? Square : Mic}
                label={view.mic.listening ? t('edit.draw.stopListening') : t('edit.draw.speak')}
                selected={view.mic.listening}
                disabled={view.busy}
                onPress={view.mic.onPress}
              />
              {view.busy ? <Button label={t('common.cancel')} variant="ghost" onPress={onCancel} /> : null}
              <Button label={t('edit.previewChange')} loading={view.busy} disabled={!view.words.trim() || view.mic.listening} onPress={onSubmit} />
            </View>
          </>
        );
      case 'waiting':
        return (
          <>
            <Text variant="h4">{view.title}</Text>
            {message(view.message)}
            {view.alternative ? (
              <View style={styles.row}>
                <Button label={view.alternative.label} variant="secondary" onPress={view.alternative.onPress} />
              </View>
            ) : null}
          </>
        );
      case 'working':
        return (
          <View style={[styles.row, { gap: space[3] }]} accessibilityLabel={t('edit.draw.working')}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ flex: 1 }}>{t('edit.draw.working')}</Text>
            <Button label={t('common.cancel')} variant="ghost" onPress={onCancel} />
          </View>
        );
      case 'proposed': {
        const keep = <Button key="keep" label={t('edit.keep')} icon={Check} loading={view.saving} onPress={onKeep} />;
        const discard = <Button key="discard" label={t('common.discard')} variant="ghost" disabled={view.saving} onPress={onDiscard} />;
        return (
          <>
            <View style={[styles.row, { gap: space[2], flexWrap: 'wrap' }]}>
              <Text variant="h4">{t('edit.proposed')}</Text>
              <SourceBadge source={view.source} />
            </View>
            <Text>{view.summary}</Text>
            {view.notes.map((n) => <Text key={n} variant="bodySmall" tone="secondary">{n}</Text>)}
            {view.warnings.map((w) => (
              <View key={w} style={[styles.row, { gap: space[2], alignItems: 'flex-start' }]}>
                <TriangleAlert size={16} color={colors.warning} style={{ marginTop: 2 }} />
                <Text variant="bodySmall" tone="warning" style={{ flex: 1 }}>{w}</Text>
              </View>
            ))}
            {message(view.message)}
            <View style={[styles.row, { gap: space[2], flexWrap: 'wrap' }]}>
              <Pressable
                onPressIn={() => onPeek(true)}
                onPressOut={() => onPeek(false)}
                accessibilityRole="button"
                accessibilityLabel={t('edit.draw.holdBefore')}
                accessibilityHint={t('edit.draw.holdBeforeHint')}
                style={({ pressed }) => [
                  styles.peek,
                  { gap: space[2], paddingHorizontal: space[3], borderRadius: radius.md, borderColor: colors.border, backgroundColor: pressed ? colors.surfaceAlt : 'transparent' },
                ]}
              >
                <Eye size={18} color={colors.textSecondary} />
                <Text variant="bodySmall" tone="secondary">{t('edit.draw.holdBefore')}</Text>
              </Pressable>
              {view.alternative ? <Button label={view.alternative.label} variant="link" onPress={view.alternative.onPress} /> : null}
            </View>
            <Text variant="caption" tone="muted">{t('edit.draw.nothingSaved')}</Text>
            <View style={[styles.row, { gap: space[2], justifyContent: leftHanded ? 'flex-start' : 'flex-end' }]}>
              {leftHanded ? [keep, discard] : [discard, keep]}
            </View>
          </>
        );
      }
    }
  })();

  return (
    <Animated.View
      entering={reduced ? undefined : FadeInUp.duration(220)}
      exiting={reduced ? undefined : FadeOut.duration(120)}
      style={[
        styles.panel,
        { backgroundColor: colors.surface, borderColor: colors.border, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space[4] },
        elevation[2],
      ]}
    >
      <Animated.View
        key={view.stage}
        entering={reduced ? undefined : FadeIn.duration(140)}
        accessibilityLiveRegion="polite"
        style={[styles.inner, { gap: space[3] }]}
      >
        {body}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth },
  inner: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  peek: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderWidth: 1 },
});
