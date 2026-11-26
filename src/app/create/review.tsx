/**
 * Review + Preview (docs/03 §13–14, docs/02 §11.5–11.6, DIRECTION §6). Left: the Understanding Review slip,
 * editable in place (C2, src/core/review). Right: the real Kalam runtime in preview mode with in-memory data,
 * following every edit, so trying the app never writes records. Save to Shelf validates the corrected app
 * once more and persists it with its first version. Leaving with unsaved edits asks first, for the back
 * arrow, the hardware or browser Back and a page reload alike.
 */
import { usePreventRemove, useRouter } from 'expo-router';
import { ArrowLeft, Check, MessageSquarePlus, Trash2 } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { routes } from '@/components/shell/routes';
import type { CreationResult } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import { inputKindFor, reportError, track } from '@/core/telemetry';
import {
  Button, CheckedImpression, ConfirmSheet, EmptyState, IconButton, SegmentedControl, Sheet, Slip, Stamp, SwitchRow, Text, TextField,
  useBreakpoint, useKalamTheme, useReducedMotion, useToast,
} from '@/design';
import { inputPartsT } from '@/features/create/input-summary';
import { mediaEvent } from '@/features/media';
import { checksPassed, rebuildText, saveStep, storedAppFrom } from '@/features/create/review-save';
import { routeSource, UnderstandingReview } from '@/features/create/UnderstandingReview';
import { useReview } from '@/features/create/use-review';
import { draftModalities } from '@/features/input/normalize';
import { useFormat, useT } from '@/i18n/react';
import { KalamRuntime } from '@/runtime/KalamRuntime';
import { createMemoryRuntimeServices } from '@/runtime/memory-services';
import { getServices } from '@/services';
import { useCreationStore } from '@/state/creation-store';

export default function ReviewScreen() {
  const router = useRouter();
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const result = useCreationStore((s) => s.result);
  const built = result?.ok ? result.spec : undefined;
  // After Save to Shelf the person chooses where to go; the draft is already cleared by then (docs/03 §13.5).
  const [saved, setSaved] = useState<{ id: string; name: string }>();
  if (saved) return <SavedChoice app={saved} />;
  if (!result || !built) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', padding: theme.space[6] }}>
        <EmptyState
          title={t('review.empty.title')}
          description={t('review.empty.description')}
          action={<Button label={t('review.empty.cta')} onPress={() => router.replace('/create')} />}
        />
      </View>
    );
  }
  // A rebuild gives a new app id: a fresh review, so edits never carry over to a different app.
  return <ReviewBody key={built.id} result={result} built={built} onSaved={setSaved} />;
}

/**
 * The explicit choice after saving (docs/03 §13.5): open the new app, or go back to the shelf. Back, and both
 * buttons, leave Create behind: the shelf is what sits under the new app, so Back from it never lands on an
 * emptied Create.
 */
function SavedChoice({ app }: { app: { id: string; name: string } }) {
  const router = useRouter();
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { colors, space } = theme;
  const insets = useSafeAreaInsets();
  const { isPhone } = useBreakpoint();
  const [guard, setGuard] = useState(true);
  const leave = () => { setGuard(false); allow(); router.dismissTo(routes.shelf); };
  const allow = usePreventRemove(guard, leave);
  const open = () => { leave(); router.push(routes.app(app.id)); };
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: space[6], paddingTop: insets.top + space[6], paddingBottom: insets.bottom + space[6] }}>
      {/* A saved app is a real record, so it gets a slip of its own (DIRECTION section 7). */}
      <Slip tint="leaf" title={t('review.savedChoice.title', { name: app.name })} style={{ width: '100%', maxWidth: 520 }} testID="saved-slip">
        <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'flex-start' }}>
          <Check size={22} color={colors.success} strokeWidth={2.6} aria-hidden style={{ marginTop: 2 }} />
          <Text tone="secondary" style={{ flex: 1 }}>{t('review.savedChoice.body')}</Text>
        </View>
        <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: space[2], marginTop: space[4] }}>
          <Button label={t('review.savedChoice.open', { name: app.name })} size="lg" onPress={open} fullWidth={isPhone} testID="open-saved-app" />
          <Button label={t('review.savedChoice.shelf')} size="lg" variant="outline" onPress={leave} fullWidth={isPhone} testID="go-to-shelf" />
        </View>
      </Slip>
    </View>
  );
}

/** The Checked stamp lands once: the one ease-in, then a short settle (DIRECTION §5). Still under reduced motion. */
function LandingStamp({ label, date, needsCheck }: { label: string; date: string; needsCheck: boolean }) {
  const reduced = useReducedMotion();
  const [v] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    if (reduced) return;
    Animated.timing(v, { toValue: 1, duration: 260, delay: 200, easing: Easing.bezier(0.55, 0.055, 0.675, 0.19), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [v, reduced]);
  return (
    <Animated.View style={{ alignSelf: 'flex-start', opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1.5, 1] }) }] }}>
      <CheckedImpression label={label} date={date} needsCheck={needsCheck} width={170} />
    </Animated.View>
  );
}

function ReviewBody({ result, built, onSaved }: { result: CreationResult; built: KalamSpec; onSaved(app: { id: string; name: string }): void }) {
  const router = useRouter();
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const format = useFormat(theme.uiLanguage);
  const { colors, space, radius } = theme;
  const insets = useSafeAreaInsets();
  const { isDesktop, isPhone } = useBreakpoint();
  const toast = useToast();
  const resultDraft = useCreationStore((s) => s.resultDraft);
  const clearResult = useCreationStore((s) => s.clearResult);
  const resetSession = useCreationStore((s) => s.resetSession);
  const setText = useCreationStore((s) => s.setText);
  const accessModes = theme.accessModes;
  const review = useReview(result, built);
  const spec = review.state.spec;
  const [tab, setTab] = useState<'review' | 'preview'>('review');
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [change, setChange] = useState('');
  const [askRebuild, setAskRebuild] = useState<KalamSpec | undefined>();
  // ADR-005: photos and drawing pages are deleted after saving unless the person keeps them (on this device only).
  const [keepPhotos, setKeepPhotos] = useState(false);
  const hasPictures = !!resultDraft && (resultDraft.photos.length > 0 || !!resultDraft.drawing);
  const services = useMemo(() => createMemoryRuntimeServices(built.id), [built.id]);
  const route = routeSource(result.route);
  const builtFrom = resultDraft ? format.list(inputPartsT(resultDraft, t)) : undefined;
  // The stamp's date in the UI language; upper case is a no-op for Indian scripts.
  const [openedAt] = useState(() => Date.now());
  const today = format.date(openedAt, 'medium').toUpperCase();
  const passed = checksPassed(result);

  // A refused edit is said where the person is looking, not only at the top of the slip.
  const editError = review.state.error;
  const { dispatch } = review;
  useEffect(() => {
    if (!editError) return;
    toast.show({ message: editError, tone: 'danger' });
    dispatch({ type: 'clearError' });
  }, [editError, dispatch, toast]);

  // Unsaved edits are never lost silently: the back arrow here, hardware or browser Back and a reload via usePreventRemove.
  const [released, setReleased] = useState(false);
  const dirty = !released && (review.state.edits > 0 || review.state.rebuild.length > 0);
  const [leaving, setLeaving] = useState<(() => void) | undefined>();
  const allowLeave = usePreventRemove(dirty, ({ repeat }) => setLeaving(() => () => { setReleased(true); repeat(); }));
  /** Called before any navigation this screen starts itself (save, rebuild, discard). */
  const release = () => { setReleased(true); allowLeave(); };
  const back = () => {
    if (dirty) { setLeaving(() => () => { release(); router.replace('/create'); }); return; }
    router.replace('/create');
  };

  const saveNow = async (final: KalamSpec) => {
    setAskRebuild(undefined);
    setSaving(true);
    try {
      const app = storedAppFrom(final, result, resultDraft, Date.now());
      await getServices().db.apps.save(app, { summary: 'Created', source: 'create' });
      track('apps_created', inputKindFor(resultDraft ? draftModalities(resultDraft) : [], { template: !!app.origin.templateId }));
      release();
      mediaEvent('accepted');
      resetSession(keepPhotos && hasPictures ? { keepInputsWith: final.id } : undefined);
      // Open or Shelf is the person's choice; this screen is replaced by it (the draft is already cleared).
      onSaved({ id: final.id, name: final.name });
    } catch (error) {
      reportError(error);
      toast.show({ message: t('review.saveError'), tone: 'danger' });
      setReleased(false);
      setSaving(false);
    }
  };

  const save = async () => {
    const step = saveStep(review.finalize());
    if (step.kind === 'fix') { toast.show({ message: step.message, tone: 'danger' }); return; }
    // Answers that need the cloud compiler are never dropped without asking (docs/06 §11.5).
    if (step.kind === 'ask') { setAskRebuild(step.spec); return; }
    await saveNow(step.spec);
  };

  /** Rebuild from the same inputs with the person's words added: a change request and any answers to uncertain items. */
  const rebuild = (extra: string[]) => {
    setText(rebuildText(useCreationStore.getState().text, extra));
    release();
    clearResult();
    router.replace('/create');
  };
  const requestChange = () => {
    const req = change.trim();
    if (req) rebuild([...review.state.rebuild, t('review.changePrefix', { change: req })]);
  };

  const discard = () => {
    setConfirmDiscard(false);
    release();
    clearResult();
    router.replace('/create');
  };

  const preview = (
    <View style={{ flex: 1, gap: space[2] }}>
      <Text variant="bodySmall" tone="secondary">{t('review.tryHint')}</Text>
      <View style={{ flex: 1, minHeight: 520, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.borderStrong, overflow: 'hidden' }}>
        <KalamRuntime spec={spec} appId={spec.id} services={services} mode="preview" accessModes={accessModes} />
      </View>
    </View>
  );

  const body = <UnderstandingReview result={result} review={review} builtFrom={builtFrom} />;

  const actions = (
    <View style={{ gap: space[4] }}>
      {changeOpen ? (
        <View style={{ gap: space[3], padding: space[5], borderRadius: radius.paper, backgroundColor: colors.surface, ...theme.elevation[1] }}>
          <TextField
            label={t('review.changeLabel')}
            value={change}
            onChangeText={setChange}
            multiline
            placeholder={t('review.changePlaceholder')}
            autoFocus
          />
          <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
            <Button label={t('review.changeSubmit')} onPress={requestChange} disabled={!change.trim()} />
            <Button label={t('common.cancel')} variant="ghost" onPress={() => setChangeOpen(false)} />
          </View>
        </View>
      ) : null}
      {hasPictures ? (
        <SwitchRow label={t('review.keep.label')} description={t('review.keep.description')} value={keepPhotos} onValueChange={setKeepPhotos} />
      ) : null}
      <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: space[2], flexWrap: 'wrap' }}>
        <Button label={t('review.save')} icon={Check} size="lg" onPress={save} loading={saving} fullWidth={isPhone} testID="save-to-shelf" />
        {!changeOpen ? <Button label={t('review.askChange')} icon={MessageSquarePlus} variant="outline" size="lg" onPress={() => setChangeOpen(true)} fullWidth={isPhone} /> : null}
        <Button label={t('common.discard')} icon={Trash2} variant="ghost" size="lg" onPress={() => setConfirmDiscard(true)} fullWidth={isPhone} />
      </View>
    </View>
  );

  const stamp = <LandingStamp label={t(passed ? 'stamp.checked' : 'stamp.needs')} date={today} needsCheck={!passed} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: space[2], paddingTop: insets.top + space[2], paddingBottom: space[2],
          paddingHorizontal: isPhone ? space[2] : space[6], borderBottomWidth: 1, borderBottomColor: colors.border,
        }}
      >
        <IconButton icon={ArrowLeft} label={t('review.backToInputs')} onPress={back} />
        <View style={{ flex: 1 }}>
          <Text variant="h4" level={1} numberOfLines={1}>{spec.name}</Text>
          {!isPhone ? <Text variant="caption" tone="muted">{t('review.title')}</Text> : null}
        </View>
        <Stamp kind={route.kind} label={t(route.label)} size="sm" />
      </View>

      {isDesktop ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space[10], gap: space[8], width: '100%', maxWidth: 860, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
            {stamp}
            {body}
            {actions}
          </ScrollView>
          <View style={{ width: 440, padding: space[6], paddingBottom: insets.bottom + space[6], borderLeftWidth: 1, borderLeftColor: colors.border }}>
            {preview}
          </View>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: space[4], paddingTop: space[3] }}>
            <SegmentedControl
              label={t('review.tabLabel')}
              labelHidden
              options={[{ value: 'review', label: t('review.tabUnderstood') }, { value: 'preview', label: t('review.tabTry') }]}
              value={tab}
              onChange={setTab}
            />
          </View>
          {tab === 'review' ? (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space[4], gap: space[6], paddingBottom: insets.bottom + space[8] }} keyboardShouldPersistTaps="handled">
              {stamp}
              {body}
              {actions}
            </ScrollView>
          ) : (
            <View style={{ flex: 1, padding: space[4], paddingBottom: insets.bottom + space[4], gap: space[3] }}>
              {preview}
              <Button label={t('review.save')} icon={Check} onPress={save} loading={saving} fullWidth />
            </View>
          )}
        </View>
      )}

      <ConfirmSheet
        visible={confirmDiscard}
        title={t('review.discardTitle')}
        message={t('review.discardMessage')}
        confirmLabel={t('review.discardConfirm')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={discard}
        onCancel={() => setConfirmDiscard(false)}
      />
      <ConfirmSheet
        visible={!!leaving}
        title={t('review.leave.title')}
        message={t('review.leave.message')}
        confirmLabel={t('review.leave.confirm')}
        cancelLabel={t('review.leave.stay')}
        destructive
        onConfirm={() => { const go = leaving; setLeaving(undefined); go?.(); }}
        onCancel={() => setLeaving(undefined)}
      />
      <Sheet
        visible={!!askRebuild}
        onClose={() => setAskRebuild(undefined)}
        title={t('review.rebuild.title')}
        description={t('review.rebuild.body', { count: review.state.rebuild.length })}
        footer={[
          <Button key="rebuild" label={t('review.rebuild.now')} onPress={() => rebuild(review.state.rebuild)} fullWidth={isPhone} />,
          <Button key="save" label={t('review.rebuild.saveAsIs')} variant="outline" onPress={() => { if (askRebuild) void saveNow(askRebuild); }} fullWidth={isPhone} />,
        ]}
      />
    </View>
  );
}
