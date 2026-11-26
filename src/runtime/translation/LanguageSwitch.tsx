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
import { Button, IconButton, Sheet, SourceBadge, Text, useKalamTheme } from '@/design';
import { QueueOffer } from '@/features/queue/QueueOffer';
import { useT } from '@/i18n/react';
import { CorrectionSheet } from './CorrectionSheet';
import { TranslationReviewSheet } from './TranslationReviewSheet';
import type { AppTranslation } from './use-app-translation';

type Panel = 'closed' | 'pick' | 'review' | 'correct';

export interface LanguageSwitchProps {
  translation: AppTranslation;
  /** An icon only (its name is the language), for a bar with no room for the language name, such as a phone. */
  compact?: boolean;
}

export function LanguageSwitch({ translation: tr, compact }: LanguageSwitchProps) {
  const t = useT();
  const [panel, setPanel] = useState<Panel>('closed');
  const [editing, setEditing] = useState<TranslatableLabel | null>(null);
  const labels = useMemo(() => (tr.original ? collectTranslatableLabels(tr.original) : []), [tr.original]);
  const notice = useMemo(() => (tr.original ? sensitiveNotice(sensitiveKinds(tr.original)) : undefined), [tr.original]);

  if (!tr.original) return null;
  const hasTranslation = tr.status === 'ready' || tr.status === 'partial' || (tr.status === 'translating' && Object.keys(tr.strings).length > 0);

  return (
    <>
      {compact ? (
        <IconButton icon={Languages} label={nativeLanguageName(tr.lang)} onPress={() => setPanel('pick')} testID="language-switch" />
      ) : (
        <Button
          label={nativeLanguageName(tr.lang)}
          icon={Languages}
          variant="ghost"
          size="sm"
          loading={tr.status === 'translating'}
          accessibilityHint={t('runtime.translate.changeHint')}
          onPress={() => setPanel('pick')}
          testID="language-switch"
        />
      )}

      <Sheet
        visible={panel === 'pick'}
        onClose={() => setPanel('closed')}
        title={t('runtime.translate.title')}
        description={t('runtime.translate.description')}
        maxWidth={520}
      >
        <View role="radiogroup" aria-label={t('runtime.translate.group')} style={{ gap: 2 }}>
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
  const t = useT();
  const isOwn = code === tr.ownLang;
  const selected = code === baseLang(tr.lang);
  const saved = tr.savedLangs.includes(code);
  const needsInternet = !isOwn && !saved && !tr.online;
  const note = t(isOwn ? 'runtime.translate.noteOwn' : saved ? 'runtime.translate.noteSaved' : needsInternet ? 'runtime.translate.noteNeedsInternet' : 'runtime.translate.noteTranslate');
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
  const t = useT();
  if (tr.isOriginal) return <View style={{ height: 8 }} />;
  const name = languageLabel(tr.lang);
  const gap = { gap: 10, marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: theme.colors.border } as const;

  if (tr.status === 'translating' || tr.status === 'checking') {
    return (
      <View style={{ ...gap, flexDirection: 'row', alignItems: 'center' }} aria-live="polite">
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={{ flex: 1 }}>{tr.status === 'translating' ? t('runtime.translate.translating', { name }) : t('runtime.translate.checking')}</Text>
      </View>
    );
  }

  const done = tr.status === 'ready' || tr.status === 'partial';
  return (
    <View style={gap} aria-live="polite">
      {done && tr.source ? (
        <SourceBadge
          source={tr.source === 'on_device' ? 'on_device' : 'cloud'}
          label={t(tr.cached ? (tr.source === 'on_device' ? 'runtime.translate.savedOnDevice' : 'runtime.translate.savedInCloud') : tr.source === 'on_device' ? 'runtime.translate.newOnDevice' : 'runtime.translate.newInCloud')}
        />
      ) : null}
      {tr.message ? <Text tone={tr.status === 'failed' ? 'danger' : 'secondary'}>{tr.message}</Text> : null}
      {tr.status === 'needs_translation' ? (
        <Button
          label={t('runtime.translate.translateInto', { name })}
          icon={Languages}
          disabled={!tr.online}
          onPress={() => void tr.translate(false)}
          accessibilityHint={tr.online ? undefined : t('runtime.translate.needsInternetHint')}
        />
      ) : null}
      {/* No signal: keep the request on this device and translate when it is back (the queue asks before it sends the labels). */}
      {tr.status === 'needs_translation' && !tr.online && tr.original ? <QueueOffer request={{ kind: 'translate', appId: tr.original.id, lang: tr.lang }} /> : null}
      {tr.status === 'failed' || tr.status === 'partial' ? (
        <Button label={t('common.tryAgain')} variant="outline" icon={RefreshCw} disabled={!tr.online} onPress={() => void tr.retry()} />
      ) : null}
      {done && notice && !tr.reviewed ? <Text tone="warning">{notice}</Text> : null}
      {canReview ? (
        <Button label={t('runtime.translate.review')} variant={done && notice && !tr.reviewed ? 'primary' : 'secondary'} icon={ListChecks} onPress={onReview} />
      ) : null}
      {done && tr.source === 'on_device' ? (
        <Button label={t('runtime.translate.cloudAgain')} variant="outline" icon={Languages} disabled={!tr.online} onPress={() => void tr.translate(true, true)} />
      ) : null}
      {done && tr.status === 'ready' ? (
        <>
          <Button label={t('runtime.translate.again')} variant="ghost" icon={RefreshCw} disabled={!tr.online} onPress={() => void tr.retry()} />
          {tr.reviewed ? <Text variant="caption" tone="secondary">{t('runtime.translate.againReplaces')}</Text> : null}
        </>
      ) : null}
      {!tr.online && tr.status !== 'ready' ? <Text variant="caption" tone="secondary">{t('runtime.translate.offline')}</Text> : null}
    </View>
  );
}
