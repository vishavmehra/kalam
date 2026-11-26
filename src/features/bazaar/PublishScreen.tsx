import { router, useFocusEffect } from 'expo-router';
import { CheckCircle2, CircleAlert, Clock, ImagePlus, Lock, Shapes, Upload, X } from 'lucide-react-native';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';

import { formatLatency } from '@/components/format';
import { AppShell } from '@/components/shell/AppShell';
import { routes } from '@/components/shell/routes';
import { useOnline } from '@/components/status/useHybridStatus';
import {
  BAZAAR_CATEGORIES, BAZAAR_LIMITS, cleanTags, deriveDisclosure, lineageForPublish, MAX_PRICE,
  remixAllowedFor, sanitizeSvg, validatePublishForm, type BazaarCategory, type BazaarListing, type ListingLicense,
  type PublishForm, type Screenshot,
} from '@/core/bazaar';
import type { BazaarPublishOutcome, BazaarPublishStage, StoredApp } from '@/core/contracts';
import { SCHEMA_VERSION } from '@/core/spec/schema';
import {
  AppIconTile, Button, Chip, cloths, EmptyState, NumberInput, Screen, SegmentedControl, Slip, slipNumber, Text, TextField, useBreakpoint, useKalamTheme,
  useToast,
} from '@/design';
import { SignInPanel } from '@/features/auth/SignInPanel';
import { publicName, useAuthUser } from '@/features/auth/use-auth';
import { publishedAppFor } from '@/infrastructure/bazaar/cache';
import { pickScreenshots } from '@/infrastructure/bazaar/media-picker';
import { pickSvgText } from '@/infrastructure/bazaar/pick-svg';
import type { TranslationKey } from '@/i18n/keys';
import { languageInfo } from '@/i18n/languages';
import { useT } from '@/i18n/react';
import type { TFunction } from '@/i18n/translator';
import { getServices } from '@/services';
import { useAppsStore } from '@/state/apps-store';

import { ListingCard } from './ListingCard';
import { ListingIcon } from './ListingIcon';
import { BackToBazaar, Busy, CATEGORY, OfflineNote, PageHead } from './parts';
import { bazaarRoutes } from './routes';

const STAGES: Record<BazaarPublishStage, TranslationKey> = {
  validating: 'bazaar.publish.stage.validating',
  checking: 'bazaar.publish.stage.checking',
  saving: 'bazaar.publish.stage.saving',
};

const emptyForm = (): PublishForm => ({ title: '', description: '', category: 'productivity', tags: [], license: 'remix_allowed', price: 0 });
const langName = (code: string) => { const l = languageInfo(code); return l.code === 'en' ? l.english : `${l.native} (${l.english})`; };

/**
 * Creator flow (docs/12 §9.1-9.2, §10, §13.2): share a local app, publish a new version of a
 * listing, or edit a listing's details without touching its spec (`mode="details"`). The form is
 * kept as a local draft while typing, so nothing is lost offline (§19.3). The price field shows only when
 * payments are switched on.
 */
export function PublishScreen({ appId, listingId, mode }: { appId?: string; listingId?: string; mode?: 'details' }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { isPhone } = useBreakpoint();
  const toast = useToast();
  const online = useOnline();
  const { user, restoring, configured } = useAuthUser();
  const bazaar = getServices().bazaar;
  const payments = bazaar.paymentsEnabled();
  const apps = useAppsStore((s) => s.apps);
  const refreshApps = useAppsStore((s) => s.refresh);
  const detailsOnly = mode === 'details' && !!listingId;

  const [selected, setSelected] = useState<string | undefined>(appId);
  const [existing, setExisting] = useState<BazaarListing | undefined>();
  const [form, setForm] = useState<PublishForm>(emptyForm);
  const [tagsText, setTagsText] = useState('');
  const [priceText, setPriceText] = useState('0');
  const [makerName, setMakerName] = useState('');
  const [shots, setShots] = useState<Screenshot[] | undefined>();
  const [touched, setTouched] = useState(false);
  const [restored, setRestored] = useState(false);
  const [stage, setStage] = useState<BazaarPublishStage | null>(null);
  const [result, setResult] = useState<BazaarPublishOutcome | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => { void refreshApps().catch(() => undefined); }, [refreshApps]));
  useEffect(() => { if (user && !makerName) setMakerName(publicName(user)); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // New version or details of an existing listing: prefill from it and preselect the app it came from.
  useEffect(() => {
    if (!listingId || !user) return;
    let alive = true;
    void (async () => {
      const got = await bazaar.getListing(listingId).catch(() => undefined);
      if (!alive || !got || got.listing.makerUid !== user.uid) return;
      const l = got.listing;
      setExisting(l);
      setForm({
        title: l.title, description: l.description, category: l.category, tags: l.tags, license: l.license, price: l.price,
        lang: l.lang, ...(l.iconSvg ? { iconSvg: l.iconSvg } : {}),
      });
      setTagsText(l.tags.join(', '));
      setPriceText(String(l.price));
      setMakerName((n) => n || l.makerName);
      setTouched(true);
      if (l.screenshotCount) setShots(await bazaar.loadMedia(l.id));
      const from = appId ?? (await publishedAppFor(listingId));
      if (alive && from) setSelected(from);
    })();
    return () => { alive = false; };
  }, [bazaar, listingId, appId, user]);

  const app = apps.find((a) => a.id === selected);

  // A saved draft for this app wins over the prefill (docs/12 §19.3).
  useEffect(() => {
    if (!selected || touched || detailsOnly) return;
    let alive = true;
    void bazaar.drafts().then((all) => {
      const d = all.find((x) => x.appId === selected && x.listingId === listingId);
      if (!alive || !d) return;
      setForm(d.form);
      setTagsText(d.form.tags.join(', '));
      setPriceText(String(d.form.price ?? 0));
      if (d.makerName) setMakerName(d.makerName);
      setTouched(true);
      setRestored(true);
    });
    return () => { alive = false; };
  }, [bazaar, selected, listingId, touched, detailsOnly]);

  // Prefill from the chosen app until the person edits the text themselves.
  useEffect(() => {
    if (!app || touched) return;
    setForm((f) => ({
      ...f,
      title: app.spec.name.slice(0, BAZAAR_LIMITS.title),
      description: (app.spec.description || app.spec.meta.description || '').slice(0, BAZAAR_LIMITS.description),
      tags: app.spec.meta.tags ?? [],
      license: app.spec.meta.license ?? f.license,
      lang: app.spec.lang,
    }));
    setTagsText((app.spec.meta.tags ?? []).join(', '));
  }, [app, touched]);

  // Without payments every listing is free, whatever an older draft said.
  const price = payments ? Number.parseInt(priceText || '0', 10) : 0;
  const fullForm: PublishForm = { ...form, tags: tagsText.split(','), price: Number.isFinite(price) ? price : -1 };

  // Keep the draft while typing.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!touched || !selected || detailsOnly) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void bazaar.saveDraft({ appId: selected, listingId, form: { ...fullForm, tags: cleanTags(fullForm.tags) }, makerName, savedAt: Date.now() });
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [form, tagsText, priceText, makerName, selected, touched]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<PublishForm>) => { setTouched(true); setForm((f) => ({ ...f, ...patch })); };
  const formErrors = validatePublishForm(fullForm);
  const nameError = makerName.trim() ? undefined : t('bazaar.publish.nameNeeded');
  const canSubmit = (detailsOnly ? !!existing : !!app && !blockedReason(app)) && !formErrors.length && !nameError && online && !stage;
  const languages = app ? [app.spec.lang, ...(app.spec.meta.supportedLanguages ?? [])] : existing ? [existing.lang] : [];

  const submit = async () => {
    setResult(null);
    const input = { form: fullForm, makerName: makerName.trim(), screenshots: shots };
    const r = detailsOnly && existing
      ? await bazaar.editDetails(existing.id, input)
      : app ? await bazaar.publish({ appId: app.id, listingId: existing?.id, ...input }, setStage) : undefined;
    setStage(null);
    if (!r) return;
    setResult(r);
    if (r.ok && makerName.trim() !== publicName(user)) void getServices().auth.setDisplayName(makerName);
  };

  const chooseIcon = async () => {
    setMediaError(null);
    try {
      const text = await pickSvgText();
      if (!text) return;
      const clean = sanitizeSvg(text);
      if (clean.ok) set({ iconSvg: clean.svg });
      else setMediaError(clean.reason);
    } catch {
      setMediaError(t('bazaar.publish.iconFailed'));
    }
  };
  const addShots = async () => {
    setMediaError(null);
    try {
      const picked = await pickScreenshots(3 - (shots?.length ?? 0));
      if (picked.error) setMediaError(picked.error);
      if (picked.shots.length) { setTouched(true); setShots([...(shots ?? []), ...picked.shots].slice(0, 3)); }
    } catch {
      setMediaError(t('bazaar.publish.shotsFailed'));
    }
  };

  const title = detailsOnly
    ? existing ? t('bazaar.publish.titleDetails', { name: existing.title }) : t('bazaar.publish.titleDetailsNone')
    : existing ? t('bazaar.publish.titleVersion', { name: existing.title }) : t('bazaar.share');

  let body: ReactNode;
  if (!configured) {
    body = <EmptyState title={t('bazaar.notSetUp.title')} description={t('bazaar.notSetUp.studio')} />;
  } else if (restoring) {
    body = <Busy text={t('bazaar.studio.checkingAccount')} />;
  } else if (!user || user.isAnonymous) {
    body = (
      <Slip tint="carbon" style={{ maxWidth: 520 }}>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Lock size={18} color={theme.colors.primary} />
          <Text variant="h3">{t('bazaar.publish.signIn')}</Text>
        </View>
        <Text tone="secondary">{t('bazaar.publish.needsAccount')}</Text>
        <SignInPanel initialMode={user?.isAnonymous ? 'signup' : 'signin'} />
      </Slip>
    );
  } else if (result?.ok || (result && !result.ok && result.issues?.length)) {
    body = (
      <Result
        result={result}
        app={app}
        onAgain={() => { setResult(null); setTouched(false); setSelected(undefined); setExisting(undefined); setForm(emptyForm()); setShots(undefined); }}
      />
    );
  } else {
    const disclosure = app ? deriveDisclosure(app.spec).disclosure : existing?.disclosure;
    const preview: BazaarListing | undefined = (app || existing) ? {
      ...(existing ?? {
        id: 'lpreviewpreviewprevi', makerUid: user.uid, specHash: '0'.repeat(64), specVersion: 1, kalamSpecVersion: SCHEMA_VERSION,
        specBytes: 1, changeSummary: '', status: 'pending_review' as const, reviewed: false, featured: false,
        safety: { verdict: 'unavailable' as const, reasons: [], specHash: '0'.repeat(64), checkedAt: 0 }, basedOn: null, capabilities: [],
        disclosure: disclosure ?? { stores: [], usesPhotos: false, aiFeatures: [], cloudPossible: false }, searchKeywords: [],
        installs: 0, likes: 0, ratingSum: 0, ratingCount: 0, ratingAvg: 0, createdAt: Date.now(), updatedAt: Date.now(),
      }),
      title: form.title.trim() || t('bazaar.publish.yourApp'), description: form.description.trim(), category: form.category,
      tags: cleanTags(fullForm.tags), lang: form.lang ?? app?.spec.lang ?? 'en', price: Math.max(0, price || 0),
      makerName: makerName.trim() || t('bazaar.publish.you'), icon: app?.spec.icon ?? existing?.icon, iconSvg: form.iconSvg,
      appColor: app?.spec.theme.primary ?? existing?.appColor ?? cloths.green.cloth, license: form.license, remixAllowed: remixAllowedFor(form.license),
      screenshotCount: shots?.length ?? 0,
    } : undefined;

    body = (
      <View style={{ gap: 36 }}>
        {!online ? <OfflineNote>{t('bazaar.publish.offline')}</OfflineNote> : null}
        {restored ? <Text tone="secondary" role="status">{t('bazaar.publish.restored')}</Text> : null}

        {detailsOnly ? null : (
          <Step n={1} title={t('bazaar.publish.step.choose')} t={t}>
            {apps.length === 0 ? (
              <EmptyState title={t('bazaar.publish.noApps')} description={t('bazaar.publish.noAppsBody')}
                action={<Button label={t('shelf.create')} onPress={() => router.push(routes.create)} />} />
            ) : (
              <View role="radiogroup" accessibilityLabel={t('bazaar.publish.appToShare')} style={{ gap: 8 }}>
                {apps.map((a) => (
                  <AppRow key={a.id} app={a} t={t} selected={a.id === selected} blocked={blockedReason(a)}
                    onPress={() => { setSelected(a.id); if (!existing) { setTouched(false); setRestored(false); } }} />
                ))}
              </View>
            )}
          </Step>
        )}

        <Step n={detailsOnly ? 1 : 2} title={t('bazaar.publish.step.describe')} t={t}>
          <View style={{ gap: 16, maxWidth: 640 }}>
            <TextField label={t('bazaar.publish.title')} value={form.title} onChangeText={(v) => set({ title: v })} maxLength={BAZAAR_LIMITS.title} />
            <TextField
              label={t('bazaar.publish.description')}
              helper={t('bazaar.publish.descriptionHint', { used: form.description.trim().length, max: BAZAAR_LIMITS.description })}
              value={form.description}
              onChangeText={(v) => set({ description: v })}
              multiline
              numberOfLines={4}
              maxLength={BAZAAR_LIMITS.description}
            />
            <View style={{ gap: 8 }}>
              <Text variant="bodySmall" weight="medium" tone="secondary">{t('bazaar.filter.category')}</Text>
              <View role="radiogroup" accessibilityLabel={t('bazaar.filter.category')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {BAZAAR_CATEGORIES.map((c: BazaarCategory) => (
                  <Chip key={c} label={t(CATEGORY[c])} role="radio" selected={form.category === c} onPress={() => set({ category: c })} />
                ))}
              </View>
            </View>
            {languages.length > 1 ? (
              <View style={{ gap: 8 }}>
                <Text variant="bodySmall" weight="medium" tone="secondary">{t('bazaar.publish.mainLanguage')}</Text>
                <View role="radiogroup" accessibilityLabel={t('bazaar.publish.mainLanguage')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {languages.map((l) => (
                    <Chip key={l} label={langName(l)} role="radio" selected={(form.lang ?? languages[0]) === l} onPress={() => set({ lang: l })} />
                  ))}
                </View>
              </View>
            ) : languages[0] ? (
              <Text variant="bodySmall" tone="secondary">{t('bazaar.publish.mainLanguageIs', { language: langName(languages[0]) })}</Text>
            ) : null}
            <TextField label={t('bazaar.publish.tags')} helper={t('bazaar.publish.tagsHint')} value={tagsText}
              onChangeText={(v) => { setTouched(true); setTagsText(v); }} autoCapitalize="none" />
            {detailsOnly ? (
              <Text variant="bodySmall" tone="secondary">{t(form.license === 'remix_allowed' ? 'bazaar.publish.licenseRemix' : 'bazaar.publish.licenseInstall')}</Text>
            ) : (
              <SegmentedControl<ListingLicense>
                label={t('bazaar.publish.remixQuestion')}
                wrap
                value={form.license}
                onChange={(v) => set({ license: v })}
                options={[
                  { value: 'remix_allowed', label: t('bazaar.publish.remixYes') },
                  { value: 'all_rights_reserved', label: t('bazaar.publish.remixNo') },
                  { value: 'personal', label: t('bazaar.publish.remixPersonal') },
                ]}
              />
            )}
            {payments ? (
              <NumberInput
                label={t('bazaar.publish.price')}
                helper={t('bazaar.publish.priceHint', { max: MAX_PRICE })}
                value={priceText === '' ? null : Number.parseInt(priceText, 10)}
                onChange={(n) => { setTouched(true); setPriceText(n === null ? '' : String(n)); }}
                min={0}
                max={MAX_PRICE}
                step={1}
                decimals={0}
              />
            ) : null}
            {existing && !detailsOnly ? (
              <TextField label={t('bazaar.publish.changed')} helper={t('bazaar.publish.changedHint')} value={form.changeSummary ?? ''}
                onChangeText={(v) => set({ changeSummary: v })} maxLength={BAZAAR_LIMITS.changeSummary} />
            ) : null}
            <TextField label={t('bazaar.publish.makerName')} helper={t('bazaar.publish.makerNameHint')} value={makerName}
              onChangeText={setMakerName} maxLength={BAZAAR_LIMITS.makerName} error={makerName ? nameError : undefined} />
          </View>
        </Step>

        <Step n={detailsOnly ? 2 : 3} title={t('bazaar.publish.step.media')} t={t}>
          <View style={{ gap: 14, maxWidth: 640 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              {preview ? <ListingIcon listing={preview} size={56} /> : null}
              <Button label={t(form.iconSvg ? 'bazaar.publish.changeIcon' : 'bazaar.publish.ownIcon')} variant="outline" icon={Shapes} onPress={chooseIcon} />
              {form.iconSvg ? <Button label={t('bazaar.publish.appIcon')} variant="ghost" onPress={() => set({ iconSvg: '' })} /> : null}
            </View>
            <Text variant="bodySmall" tone="muted">{t('bazaar.publish.iconNote')}</Text>
            <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
              {(shots ?? []).map((s, i) => (
                <View key={i}>
                  <Image source={{ uri: `data:${s.mimeType};base64,${s.base64}` }} accessibilityLabel={t('bazaar.listing.screenshot', { n: i + 1, total: shots?.length ?? 0 })}
                    style={{ width: Math.round((s.width / s.height) * 140), height: 140, borderRadius: theme.radius.paper, borderWidth: 1, borderColor: theme.colors.border }} />
                  <View style={{ position: 'absolute', top: 2, end: 2 }}>
                    <Button label={t('common.remove')} size="sm" variant="secondary" icon={X} onPress={() => { setTouched(true); setShots((shots ?? []).filter((_, j) => j !== i)); }} />
                  </View>
                </View>
              ))}
            </View>
            {(shots?.length ?? 0) < 3 ? (
              <View style={{ alignSelf: 'flex-start' }}>
                <Button label={t('bazaar.publish.addShots')} variant="outline" icon={ImagePlus} onPress={addShots} />
              </View>
            ) : null}
            <Text variant="bodySmall" tone="muted">{t('bazaar.publish.shotsNote')}</Text>
            {mediaError ? <Text tone="danger" role="alert">{mediaError}</Text> : null}
          </View>
        </Step>

        <Step n={detailsOnly ? 3 : 4} title={t('bazaar.publish.step.check')} t={t}>
          <View style={{ gap: 16, flexDirection: isPhone ? 'column' : 'row', alignItems: 'flex-start' }}>
            <Slip tint="kraft" style={{ flex: isPhone ? undefined : 1, maxWidth: 560 }}>
              {app || existing ? (
                <>
                  {app ? <Line>{t('bazaar.publish.shared', { name: app.spec.name, count: app.spec.screens.length })}</Line> : null}
                  <Line>{t('bazaar.publish.notShared')}</Line>
                  {disclosure?.stores.length ? <Line>{t('bazaar.publish.keeps', { what: disclosure.stores.join(', ').toLowerCase() })}</Line> : null}
                  {disclosure?.aiFeatures.length ? <Line>{t('bazaar.publish.aiFeatures', { what: disclosure.aiFeatures.join('; ') })}</Line> : null}
                  <Line>{t('bazaar.publish.checks')}</Line>
                </>
              ) : <Text tone="secondary">{t('bazaar.publish.chooseFirst')}</Text>}
            </Slip>
            {preview ? (
              <View style={{ gap: 8, width: isPhone ? '100%' : 230 }}>
                <Text variant="bodySmall" weight="medium" tone="secondary">{t('bazaar.publish.looks')}</Text>
                <View style={{ width: 220, alignSelf: isPhone ? 'center' : 'flex-start' }}><ListingCard listing={preview} payments={payments} height={340} preview /></View>
              </View>
            ) : null}
          </View>
        </Step>

        {result && !result.ok ? <Text tone="danger" role="alert">{result.message}</Text> : null}
        {touched && formErrors.length ? <Text tone="danger">{formErrors[0]}</Text> : null}

        <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 16, alignItems: isPhone ? 'stretch' : 'center' }}>
          <Button
            label={detailsOnly ? t('bazaar.publish.saveDetails') : existing ? t('bazaar.publish.publishVersion', { version: existing.specVersion + 1 }) : t('shelf.actions.share')}
            icon={Upload}
            size="lg"
            loading={!!stage}
            disabled={!canSubmit}
            onPress={submit}
          />
          {stage ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }} role="status">
              <ActivityIndicator color={theme.colors.primary} />
              <Text tone="secondary">{t(STAGES[stage])}</Text>
            </View>
          ) : null}
          {!detailsOnly && selected && touched ? (
            <Button label={t('bazaar.publish.discardDraft')} variant="ghost" onPress={async () => {
              await bazaar.removeDraft(selected);
              setTouched(false);
              setRestored(false);
              toast.show({ message: t('bazaar.publish.draftRemoved'), tone: 'info' });
            }} />
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <AppShell active="bazaar">
      <Screen maxWidth={900}>
        <BackToBazaar t={t} />
        <PageHead title={title} lede={t(detailsOnly ? 'bazaar.publish.ledeDetails' : 'bazaar.publish.lede')} />
        {body}
      </Screen>
    </AppShell>
  );
}

/** Apps installed from someone else cannot be republished as your own; remixes can (with credit). */
function blockedReason(app: StoredApp | undefined): string | undefined {
  if (!app) return undefined;
  const check = lineageForPublish([app.spec.meta]); // the service also walks local duplicates
  return check.ok ? undefined : check.message;
}

function Result({ result, app, onAgain }: { result: BazaarPublishOutcome; app?: StoredApp; onAgain: () => void }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const tone = result.status === 'published' ? 'success' : result.status === 'pending_review' ? 'warning' : 'danger';
  const Icon = result.status === 'published' ? CheckCircle2 : result.status === 'pending_review' ? Clock : CircleAlert;
  const title = t(result.status === 'published' ? 'bazaar.publish.result.shared' : result.status === 'pending_review' ? 'bazaar.publish.result.waiting' : 'bazaar.status.rejected');
  const review = result.review;
  return (
    <Slip tint={result.status === 'published' ? 'leaf' : 'haldi'} style={{ maxWidth: 640 }}>
      <View role="status" style={{ gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon size={24} color={theme.colors[tone]} />
          <Text variant="h3">{title}</Text>
        </View>
        <Text>{result.message}</Text>
        {result.reasons?.length && result.status !== 'published' ? (
          <View style={{ gap: 6 }}>{result.reasons.map((r) => <Line key={r}>{r}</Line>)}</View>
        ) : null}
        {result.issues?.length ? (
          <View style={{ gap: 6 }}>{result.issues.slice(0, 5).map((i) => <Line key={`${i.path}${i.code}`}>{i.message}</Line>)}</View>
        ) : null}
        {review ? (
          <Text variant="bodySmall" tone="muted">
            {review.cached
              ? t('bazaar.publish.result.cached')
              : review.source === 'cloud'
                ? t('bazaar.publish.result.cloud', { model: review.model ? ` (${review.model})` : '', time: formatLatency(review.latencyMs) })
                : t('bazaar.publish.result.notRun')}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          {result.status === 'published' && result.listingId ? (
            <Button label={t('bazaar.publish.result.view')} onPress={() => router.push(bazaarRoutes.listing(result.listingId!))} />
          ) : null}
          {(result.status === 'rejected' || result.issues?.length) && app ? (
            <Button label={t('bazaar.publish.result.editApp')} onPress={() => router.push(routes.editApp(app.id))} />
          ) : null}
          <Button label={t('bazaar.studio.title')} variant="outline" onPress={() => router.push(bazaarRoutes.mine)} />
          <Button label={t('bazaar.publish.result.another')} variant="ghost" onPress={onAgain} />
        </View>
      </View>
    </Slip>
  );
}

function AppRow({ app, t, selected, blocked, onPress }: { app: StoredApp; t: TFunction; selected: boolean; blocked?: string; onPress: () => void }) {
  const theme = useKalamTheme();
  const c = theme.colors;
  return (
    <Pressable
      role="radio"
      aria-checked={selected}
      accessibilityState={{ checked: selected, disabled: !!blocked }}
      accessibilityLabel={`${app.spec.name}${blocked ? `. ${blocked}` : ''}`}
      disabled={!!blocked}
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, minHeight: Math.max(64, theme.touchTarget), borderRadius: theme.radius.press,
        borderWidth: selected ? 1.75 : 1.25, borderColor: selected ? c.primary : c.borderStrong,
        backgroundColor: selected ? c.primarySoft : c.surface, opacity: blocked ? 0.6 : 1,
      }}
    >
      <AppIconTile icon={app.spec.icon} appColor={app.spec.theme.primary} size={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="semibold" numberOfLines={1}>{app.spec.name}</Text>
        <Text variant="bodySmall" tone="muted" numberOfLines={2}>{blocked ?? t('shelf.screens', { count: app.spec.screens.length })}</Text>
      </View>
      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: selected ? c.primary : c.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
        {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.primary }} /> : null}
      </View>
    </Pressable>
  );
}

/** A numbered step, numbered like an order-book slip ("No. 01"). */
function Step({ n, title, t, children }: { n: number; title: string; t: TFunction; children: ReactNode }) {
  const theme = useKalamTheme();
  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 2 }}>
        <Text mono variant="caption" style={{ color: theme.colors.markInk }}>{slipNumber(n, 2, t('slip.no'))}</Text>
        <Text variant="h3">{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Line({ children }: { children: ReactNode }) {
  const theme = useKalamTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ width: 6, height: 6, borderRadius: 1, backgroundColor: theme.colors.mark, marginTop: 9 }} />
      <Text style={{ flex: 1 }}>{children}</Text>
    </View>
  );
}
