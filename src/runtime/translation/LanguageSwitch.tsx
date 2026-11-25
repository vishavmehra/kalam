/**
 * Language switch for a running app (docs/03 §20, docs/10 §14.4, docs/09 §12.3). A small button for the app
 * header opens a sheet with the app's own language, languages that are already saved (they work offline) and
 * languages that can be translated now. A failed translation leaves the original labels on screen.
 *
 * Self-contained: pass the result of `useAppTranslation(spec)`. It also hosts the review list and the
 * single-label correction sheet, one sheet open at a time.
 */
import { Check, Languages, RefreshCw, ListChecks } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import {
  baseLang, collectTranslatableLabels, languageLabel, nativeLanguageName, sensitiveKinds, sensitiveNotice,
  type TranslatableLabel,
} from '@/core/i18n-labels';
import { Button, Sheet, SourceBadge, Text, useKalamTheme } from '@/design';
import { CorrectionSheet } from './CorrectionSheet';
import { TranslationReviewSheet } from './TranslationReviewSheet';
import type { AppTranslation } from './use-app-translation';

type Panel = 'closed' | 'pick' | 'review' | 'correct';

export interface LanguageSwitchProps {
  translation: AppTranslation;
}

export function LanguageSwitch({ translation: tr }: LanguageSwitchProps) {
  const [panel, setPanel] = useState<Panel>('closed');
  const [editing, setEditing] = useState<TranslatableLabel | null>(null);
  const labels = useMemo(() => (tr.original ? collectTranslatableLabels(tr.original) : []), [tr.original]);
  const notice = useMemo(() => (tr.original ? sensitiveNotice(sensitiveKinds(tr.original)) : undefined), [tr.original]);

  if (!tr.original) return null;
  const hasTranslation = tr.status === 'ready' || tr.status === 'partial' || (tr.status === 'translating' && Object.keys(tr.strings).length > 0);

  return (
    <>
      <Button
        label={nativeLanguageName(tr.lang)}
        icon={Languages}
        variant="ghost"
        size="sm"
        loading={tr.status === 'translating'}
        accessibilityHint="Change the language of this app"
        onPress={() => setPanel('pick')}
        testID="language-switch"
      />

      <Sheet
        visible={panel === 'pick'}
        onClose={() => setPanel('closed')}
        title="Language of this app"
        description="Kalam changes the labels and buttons. Your entries stay exactly as you typed them."
        maxWidth={520}
      >
        <View role="radiogroup" aria-label="App language" style={{ gap: 2 }}>
          {languageCodes(tr).map((code) => (
            <LanguageRow key={code} code={code} tr={tr} />
          ))}
        </View>
        <StatusBlock
          tr={tr}
          canReview={hasTranslation && labels.length > 0}
          notice={notice}
          onReview={() => setPanel('review')}
        />
      </Sheet>

      <TranslationReviewSheet
        visible={panel === 'review'}
        translation={tr}
        onClose={() => setPanel('pick')}
        onEdit={(label) => {
          setEditing(label);
          setPanel('correct');
        }}
      />

      <CorrectionSheet
        visible={panel === 'correct'}
        label={editing}
        lang={tr.lang}
        current={editing ? tr.strings[editing.key] : undefined}
        onSave={(text) => (editing ? tr.correct(editing.key, text) : Promise.resolve())}
        onClose={() => setPanel('review')}
      />
    </>
  );
}

/** Own language first, then saved languages, then the rest. */
function languageCodes(tr: AppTranslation): string[] {
  const saved = tr.offered.filter((c) => tr.savedLangs.includes(c));
  const rest = tr.offered.filter((c) => !tr.savedLangs.includes(c));
  return [tr.ownLang, ...saved, ...rest];
}

function LanguageRow({ code, tr }: { code: string; tr: AppTranslation }) {
  const theme = useKalamTheme();
  const isOwn = code === tr.ownLang;
  const selected = code === baseLang(tr.lang);
  const saved = tr.savedLangs.includes(code);
  const needsInternet = !isOwn && !saved && !tr.online;
  const note = isOwn ? 'Original language of this app' : saved ? 'Saved on this device' : needsInternet ? 'Needs internet' : 'Translate this app';
  const disabled = tr.busy || (needsInternet && !selected);
  return (
    <Pressable
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      accessibilityLabel={`${languageLabel(code)}. ${note}`}
      disabled={disabled}
      onPress={() => tr.setLang(code)}
      testID={`language-option-${code}`}
      style={({ pressed }) => ({
        minHeight: theme.touchTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginHorizontal: -12,
        borderRadius: theme.radius.md,
        opacity: disabled && !selected ? 0.55 : 1,
        backgroundColor: selected ? theme.colors.primarySoft : pressed ? theme.colors.surfaceAlt : 'transparent',
      })}
    >
      <View style={{ flex: 1 }}>
        <Text weight="medium">{nativeLanguageName(code)}</Text>
        <Text variant="bodySmall" tone="secondary">{`${languageLabel(code)}. ${note}`}</Text>
      </View>
      {selected ? <Check size={20} color={theme.colors.primary} strokeWidth={2.5} /> : null}
    </Pressable>
  );
}

function StatusBlock({ tr, canReview, notice, onReview }: { tr: AppTranslation; canReview: boolean; notice?: string; onReview(): void }) {
  const theme = useKalamTheme();
  if (tr.isOriginal) return <View style={{ height: 8 }} />;
  const name = languageLabel(tr.lang);
  const gap = { gap: 10, marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: theme.colors.border } as const;

  if (tr.status === 'translating' || tr.status === 'checking') {
    return (
      <View style={{ ...gap, flexDirection: 'row', alignItems: 'center' }} aria-live="polite">
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={{ flex: 1 }}>{tr.status === 'translating' ? `Translating into ${name}. This takes a few seconds.` : 'Looking for a saved translation.'}</Text>
      </View>
    );
  }

  const done = tr.status === 'ready' || tr.status === 'partial';
  return (
    <View style={gap} aria-live="polite">
      {done && tr.source ? (
        <SourceBadge
          source={tr.source === 'on_device' ? 'on_device' : 'cloud'}
          label={`${tr.cached ? 'Saved translation' : 'Translated'}, made ${tr.source === 'on_device' ? 'on this device' : 'in the cloud'}`}
        />
      ) : null}
      {tr.message ? <Text tone={tr.status === 'failed' ? 'danger' : 'secondary'}>{tr.message}</Text> : null}
      {tr.status === 'needs_translation' ? (
        <Button
          label={`Translate into ${name}`}
          icon={Languages}
          disabled={!tr.online}
          onPress={() => void tr.translate(false)}
          accessibilityHint={tr.online ? undefined : 'Needs an internet connection'}
        />
      ) : null}
      {tr.status === 'failed' || tr.status === 'partial' ? (
        <Button label="Try again" variant="outline" icon={RefreshCw} disabled={!tr.online} onPress={() => void tr.retry()} />
      ) : null}
      {done && notice && !tr.reviewed ? <Text tone="warning">{notice}</Text> : null}
      {canReview ? (
        <Button label="Review and change labels" variant={done && notice && !tr.reviewed ? 'primary' : 'secondary'} icon={ListChecks} onPress={onReview} />
      ) : null}
      {done && tr.source === 'on_device' ? (
        <Button label="Translate again in the cloud" variant="outline" icon={Languages} disabled={!tr.online} onPress={() => void tr.translate(true, true)} />
      ) : null}
      {done && tr.status === 'ready' ? (
        <>
          <Button label="Translate again" variant="ghost" icon={RefreshCw} disabled={!tr.online} onPress={() => void tr.retry()} />
          {tr.reviewed ? <Text variant="caption" tone="secondary">Translating again replaces the wording you changed.</Text> : null}
        </>
      ) : null}
      {!tr.online && tr.status !== 'ready' ? <Text variant="caption" tone="secondary">You are offline. Saved translations still work.</Text> : null}
    </View>
  );
}
