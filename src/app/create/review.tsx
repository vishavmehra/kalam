/**
 * Review + Preview (docs/03 §13–14, docs/02 §11.5–11.6). Left: what Kalam understood, in plain
 * language. Right: the real Kalam runtime in preview mode with in-memory data, so trying the
 * app never writes records. Save to Shelf persists the app with its first version.
 */
import { useRouter } from 'expo-router';
import { ArrowLeft, Check, MessageSquarePlus, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StoredApp } from '@/core/contracts';
import {
  Button, ConfirmSheet, EmptyState, IconButton, SegmentedControl, SourceBadge, Surface, SwitchRow, Text, TextField,
  useBreakpoint, useKalamTheme, useToast,
} from '@/design';
import { inputParts, joinParts } from '@/features/create/input-summary';
import { routeSource, UnderstandingReview } from '@/features/create/UnderstandingReview';
import { creationInputRecord } from '@/features/input/normalize';
import { KalamRuntime } from '@/runtime/KalamRuntime';
import { createMemoryRuntimeServices } from '@/runtime/memory-services';
import { getServices } from '@/services';
import { useCreationStore } from '@/state/creation-store';

export default function ReviewScreen() {
  const router = useRouter();
  const { colors, space, radius } = useKalamTheme();
  const insets = useSafeAreaInsets();
  const { isDesktop, isPhone } = useBreakpoint();
  const toast = useToast();
  const result = useCreationStore((s) => s.result);
  const resultDraft = useCreationStore((s) => s.resultDraft);
  const clearResult = useCreationStore((s) => s.clearResult);
  const resetSession = useCreationStore((s) => s.resetSession);
  const setText = useCreationStore((s) => s.setText);
  const accessModes = useKalamTheme().accessModes;
  const [tab, setTab] = useState<'review' | 'preview'>('review');
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [change, setChange] = useState('');
  // ADR-005: photos and drawing pages are deleted after saving unless the person keeps them (on this device only).
  const [keepPhotos, setKeepPhotos] = useState(false);
  const hasPictures = !!resultDraft && (resultDraft.photos.length > 0 || !!resultDraft.drawing);
  const built = result?.ok ? result.spec : undefined;
  // The person can correct the app's name right here (docs/03 §13.3); the preview follows.
  const [name, setName] = useState<string | undefined>(undefined);
  const spec = useMemo(() => {
    const next = name?.trim();
    if (!built || !next || next === built.name) return built;
    const out = getServices().edit.applyOps(built, [{ op: 'setAppName', value: next.slice(0, 60) }], `Named ${next}`);
    return out.ok && out.spec ? out.spec : built;
  }, [built, name]);
  const services = useMemo(() => (built ? createMemoryRuntimeServices(built.id) : undefined), [built]);

  if (!result || !spec || !services) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: space[6] }}>
        <EmptyState
          title="Nothing to review yet"
          description="Describe, sketch or draw an app first. Kalam shows what it understood here before anything is saved."
          action={<Button label="Start a new app" onPress={() => router.replace('/create')} />}
        />
      </View>
    );
  }

  const understanding = result.understanding;
  const route = routeSource(result.route);

  const save = async () => {
    setSaving(true);
    try {
      const now = Date.now();
      const templateId = spec.meta.templateId ?? (result.route.startsWith('template') ? result.classification.matchingTemplate : undefined);
      const app: StoredApp = {
        id: spec.id,
        spec,
        createdAt: now,
        updatedAt: now,
        origin: {
          route: result.route,
          ...(result.provider !== 'none' ? { provider: result.provider } : {}),
          ...(result.model ? { model: result.model } : {}),
          ...(templateId ? { templateId } : {}),
        },
        ...(resultDraft ? { creationInput: creationInputRecord(resultDraft) } : {}),
      };
      await getServices().db.apps.save(app, { summary: 'Created', source: 'create' });
      toast.show({ message: `${spec.name} saved to your shelf`, tone: 'success' });
      resetSession(keepPhotos && hasPictures ? { keepInputsWith: spec.id } : undefined);
      router.replace(`/app/${spec.id}`);
    } catch {
      toast.show({ message: 'The app could not be saved. Your preview is still here. Try again.', tone: 'danger' });
      setSaving(false);
    }
  };

  const requestChange = () => {
    const req = change.trim();
    if (!req) return;
    const base = useCreationStore.getState().text.trim();
    setText(`${base}${base ? '\n\n' : ''}Change: ${req}`.slice(0, 4000));
    clearResult();
    router.replace('/create');
  };

  const discard = () => {
    setConfirmDiscard(false);
    clearResult();
    router.replace('/create');
  };

  const preview = (
    <View style={{ flex: 1, gap: space[2] }}>
      <Text variant="bodySmall" tone="secondary">Try it out here. Nothing you enter in the preview is saved.</Text>
      <View style={{ flex: 1, minHeight: 520, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.borderStrong, overflow: 'hidden' }}>
        <KalamRuntime spec={spec} appId={spec.id} services={services} mode="preview" accessModes={accessModes} />
      </View>
    </View>
  );

  const nameField = (
    <TextField
      label="App name"
      value={name ?? spec.name}
      onChangeText={(t) => setName(t.slice(0, 60))}
      helper="Change it now or later. The preview uses this name."
    />
  );

  const review = understanding ? (
    <UnderstandingReview result={result} understanding={understanding} builtFrom={resultDraft ? joinParts(inputParts(resultDraft)) : undefined} />
  ) : (
    <Text tone="secondary">Kalam built this app but has no summary for it. Use the preview to check it.</Text>
  );

  const actions = (
    <View style={{ gap: space[3] }}>
      {changeOpen ? (
        <Surface tone="alt" padded radius="lg" style={{ gap: space[3] }}>
          <TextField
            label="What should be different?"
            value={change}
            onChangeText={setChange}
            multiline
            placeholder="e.g. add a phone number field and show the total pending at the top"
            autoFocus
          />
          <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
            <Button label="Rebuild with this change" onPress={requestChange} disabled={!change.trim()} />
            <Button label="Cancel" variant="ghost" onPress={() => setChangeOpen(false)} />
          </View>
        </Surface>
      ) : null}
      {hasPictures ? (
        <SwitchRow
          label="Keep my photos and sketches with this app"
          description="They stay on this device and are never uploaded. Otherwise they are deleted when you save."
          value={keepPhotos}
          onValueChange={setKeepPhotos}
        />
      ) : null}
      <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: space[2], flexWrap: 'wrap' }}>
        <Button label="Save to Shelf" icon={Check} size="lg" onPress={save} loading={saving} fullWidth={isPhone} testID="save-to-shelf" />
        {!changeOpen ? <Button label="Ask for a change" icon={MessageSquarePlus} variant="outline" size="lg" onPress={() => setChangeOpen(true)} fullWidth={isPhone} /> : null}
        <Button label="Discard" icon={Trash2} variant="ghost" size="lg" onPress={() => setConfirmDiscard(true)} fullWidth={isPhone} />
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: space[2], paddingTop: insets.top + space[2], paddingBottom: space[2],
          paddingHorizontal: isPhone ? space[2] : space[6], borderBottomWidth: 1, borderBottomColor: colors.border,
        }}
      >
        <IconButton icon={ArrowLeft} label="Back to your inputs" onPress={() => router.replace('/create')} />
        <View style={{ flex: 1 }}>
          <Text variant="h4" numberOfLines={1} accessibilityRole="header">{name?.trim() || understanding?.appName || spec.name}</Text>
          {!isPhone ? <Text variant="caption" tone="muted">Review before saving</Text> : null}
        </View>
        <SourceBadge source={route.source} label={route.label} size="sm" />
      </View>

      {isDesktop ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space[10], gap: space[8], maxWidth: 760 }}>
            <Text variant="h1" display>Here is what Kalam understood</Text>
            {nameField}
            {review}
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
              label="View"
              labelHidden
              options={[{ value: 'review', label: 'What Kalam understood' }, { value: 'preview', label: 'Try it' }]}
              value={tab}
              onChange={setTab}
            />
          </View>
          {tab === 'review' ? (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space[4], gap: space[8], paddingBottom: insets.bottom + space[8] }}>
              {nameField}
              {review}
              {actions}
            </ScrollView>
          ) : (
            <View style={{ flex: 1, padding: space[4], paddingBottom: insets.bottom + space[4], gap: space[3] }}>
              {preview}
              <Button label="Save to Shelf" icon={Check} onPress={save} loading={saving} fullWidth />
            </View>
          )}
        </View>
      )}

      <ConfirmSheet
        visible={confirmDiscard}
        title="Discard this app?"
        message="The generated app is thrown away. Everything you described, photographed or drew stays in your session."
        confirmLabel="Discard app"
        destructive
        onConfirm={discard}
        onCancel={() => setConfirmDiscard(false)}
      />
    </View>
  );
}
