import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft, CheckCircle2, CircleAlert, Clock, CloudOff, ImagePlus, Lock, Shapes, Upload, X } from 'lucide-react-native';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';

import { formatLatency } from '@/components/format';
import { AppShell } from '@/components/shell/AppShell';
import { routes } from '@/components/shell/routes';
import { useOnline } from '@/components/status/useHybridStatus';
import {
  BAZAAR_CATEGORIES, BAZAAR_LIMITS, CATEGORY_LABELS, cleanTags, deriveDisclosure, lineageForPublish, MAX_PRICE,
  remixAllowedFor, sanitizeSvg, validatePublishForm, type BazaarCategory, type BazaarListing, type ListingLicense,
  type PublishForm, type Screenshot,
} from '@/core/bazaar';
import type { BazaarPublishOutcome, BazaarPublishStage, StoredApp } from '@/core/contracts';
import { languageName } from '@/core/spec/describe';
import { SCHEMA_VERSION } from '@/core/spec/schema';
import {
  AppIconTile, Button, Chip, EmptyState, Screen, SegmentedControl, Surface, Text, TextField, useBreakpoint, useKalamTheme,
  useToast,
} from '@/design';
import { SignInPanel } from '@/features/auth/SignInPanel';
import { publicName, useAuthUser } from '@/features/auth/use-auth';
import { publishedAppFor } from '@/infrastructure/bazaar/cache';
import { pickScreenshots } from '@/infrastructure/bazaar/media-picker';
import { pickSvgText } from '@/infrastructure/bazaar/pick-svg';
import { getServices } from '@/services';
import { useAppsStore } from '@/state/apps-store';

import { ListingCard } from './ListingCard';
import { ListingIcon } from './ListingIcon';
import { bazaarRoutes } from './routes';

const STAGES: Record<BazaarPublishStage, string> = {
  validating: 'Checking the app design',
  checking: 'Running the safety check with Firebase cloud AI',
  saving: 'Saving your listing',
};

const emptyForm = (): PublishForm => ({ title: '', description: '', category: 'productivity', tags: [], license: 'remix_allowed', price: 0 });

/**
 * Creator flow (docs/12 §9.1-9.2, §10, §13.2): share a local app, publish a new version of a
 * listing, or edit a listing's details without touching its spec (`mode="details"`). The form is
 * kept as a local draft while typing, so nothing is lost offline (§19.3).
 */
export function PublishScreen({ appId, listingId, mode }: { appId?: string; listingId?: string; mode?: 'details' }) {
  const theme = useKalamTheme();
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

  const price = Number.parseInt(priceText || '0', 10);
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
  const nameError = makerName.trim() ? undefined : 'Choose the name people will see.';
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
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : 'That icon could not be used.');
    }
  };
  const addShots = async () => {
    setMediaError(null);
    try {
      const picked = await pickScreenshots(3 - (shots?.length ?? 0));
      if (picked.error) setMediaError(picked.error);
      if (picked.shots.length) { setTouched(true); setShots([...(shots ?? []), ...picked.shots].slice(0, 3)); }
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : 'Those screenshots could not be used.');
    }
  };

  const title = detailsOnly ? `Edit details of ${existing?.title ?? 'your listing'}` : existing ? `New version of ${existing.title}` : 'Share an app';
  const header = (
    <View style={{ gap: 6, marginBottom: 24 }}>
      <View style={{ alignSelf: 'flex-start', marginLeft: -8, marginBottom: 8 }}>
        <Button label="Back" variant="ghost" size="sm" icon={ArrowLeft}
          onPress={() => (router.canGoBack() ? router.back() : router.replace(bazaarRoutes.home))} />
      </View>
      <Text variant="h1">{title}</Text>
      <Text tone="secondary">
        {detailsOnly
          ? 'Change how your listing looks. The app itself stays the same. To change the app or its licence, publish a new version.'
          : 'People can install a copy of your app. Only the app design is shared. The records you saved in it stay on this device.'}
      </Text>
    </View>
  );

  let body: ReactNode;
  if (!configured) {
    body = <EmptyState title="Kalam Bazaar is not set up in this build" description="Sharing needs Firebase to be configured." />;
  } else if (restoring) {
    body = <Loading text="Checking your account" />;
  } else if (!user || user.isAnonymous) {
    body = (
      <Surface padded={24} style={{ gap: 16, maxWidth: 520 }}>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Lock size={18} color={theme.colors.primary} />
          <Text variant="h3">Sign in to share</Text>
        </View>
        <Text tone="secondary">
          {user?.isAnonymous
            ? 'Guest accounts cannot share apps. Add an email so your listings stay yours.'
            : 'Sharing needs an account so your listings stay yours. You can keep using Kalam without one.'}
        </Text>
        <SignInPanel initialMode={user?.isAnonymous ? 'signup' : 'signin'} />
      </Surface>
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
      title: form.title.trim() || 'Your app', description: form.description.trim(), category: form.category,
      tags: cleanTags(fullForm.tags), lang: form.lang ?? app?.spec.lang ?? 'en', price: Math.max(0, price || 0),
      makerName: makerName.trim() || 'You', icon: app?.spec.icon ?? existing?.icon, iconSvg: form.iconSvg,
      appColor: app?.spec.theme.primary ?? existing?.appColor ?? '#315C4C', license: form.license, remixAllowed: remixAllowedFor(form.license),
      screenshotCount: shots?.length ?? 0,
    } : undefined;

    body = (
      <View style={{ gap: 32 }}>
        {!online ? (
          <Surface tone="alt" padded={14} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }} role="status">
            <CloudOff size={18} color={theme.colors.warning} />
            <Text style={{ flex: 1 }}>You are offline. Your details are saved on this device. Share when you are back online.</Text>
          </Surface>
        ) : null}
        {restored ? <Text tone="secondary" role="status">Your unsent details were restored.</Text> : null}

        {detailsOnly ? null : (
          <Step n={1} title="Choose an app">
            {apps.length === 0 ? (
              <EmptyState title="No apps on this device yet" description="Make an app first, then come back to share it."
                action={<Button label="Create an app" onPress={() => router.push(routes.create)} />} />
            ) : (
              <View role="radiogroup" accessibilityLabel="App to share" style={{ gap: 8 }}>
                {apps.map((a) => (
                  <AppRow key={a.id} app={a} selected={a.id === selected} blocked={blockedReason(a)}
                    onPress={() => { setSelected(a.id); if (!existing) { setTouched(false); setRestored(false); } }} />
                ))}
              </View>
            )}
          </Step>
        )}

        <Step n={detailsOnly ? 1 : 2} title="Describe it">
          <View style={{ gap: 16, maxWidth: 640 }}>
            <TextField label="Title" value={form.title} onChangeText={(v) => set({ title: v })} maxLength={BAZAAR_LIMITS.title} />
            <TextField
              label="Description"
              helper={`What it is for and who it helps. ${form.description.trim().length}/${BAZAAR_LIMITS.description} characters.`}
              value={form.description}
              onChangeText={(v) => set({ description: v })}
              multiline
              numberOfLines={4}
              maxLength={BAZAAR_LIMITS.description}
            />
            <View style={{ gap: 8 }}>
              <Text variant="bodySmall" weight="medium" tone="secondary">Category</Text>
              <View role="radiogroup" accessibilityLabel="Category" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {BAZAAR_CATEGORIES.map((c: BazaarCategory) => (
                  <Chip key={c} label={CATEGORY_LABELS[c]} role="radio" selected={form.category === c} onPress={() => set({ category: c })} />
                ))}
              </View>
            </View>
            {languages.length > 1 ? (
              <View style={{ gap: 8 }}>
                <Text variant="bodySmall" weight="medium" tone="secondary">Main language</Text>
                <View role="radiogroup" accessibilityLabel="Main language" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {languages.map((l) => (
                    <Chip key={l} label={languageName(l)} role="radio" selected={(form.lang ?? languages[0]) === l} onPress={() => set({ lang: l })} />
                  ))}
                </View>
              </View>
            ) : languages[0] ? (
              <Text variant="bodySmall" tone="secondary">Main language: {languageName(languages[0])}</Text>
            ) : null}
            <TextField label="Tags" helper="Words people might search for, separated by commas." value={tagsText}
              onChangeText={(v) => { setTouched(true); setTagsText(v); }} autoCapitalize="none" />
            {detailsOnly ? (
              <Text variant="bodySmall" tone="secondary">Licence: {form.license === 'remix_allowed' ? 'others may remix it' : 'install and use only'}.</Text>
            ) : (
              <SegmentedControl<ListingLicense>
                label="Can other people remix it?"
                wrap
                value={form.license}
                onChange={(v) => set({ license: v })}
                options={[
                  { value: 'remix_allowed', label: 'Yes, credit me' },
                  { value: 'all_rights_reserved', label: 'No, install only' },
                  { value: 'personal', label: 'Personal use only' },
                ]}
              />
            )}
            {payments ? (
              <TextField
                label="Price in credits"
                helper={`0 means free. Up to ${MAX_PRICE}. Credits are a test currency, not money.`}
                value={priceText}
                onChangeText={(v) => { setTouched(true); setPriceText(v.replace(/[^0-9]/g, '').slice(0, 4)); }}
                keyboardType="number-pad"
                inputMode="numeric"
              />
            ) : (
              <Text variant="bodySmall" tone="secondary">Price: free. Paid apps are not available yet.</Text>
            )}
            {existing && !detailsOnly ? (
              <TextField label="What changed in this version?" helper="Shown to people who installed it." value={form.changeSummary ?? ''}
                onChangeText={(v) => set({ changeSummary: v })} maxLength={BAZAAR_LIMITS.changeSummary} />
            ) : null}
            <TextField label="Your name in Kalam Bazaar" helper="Shown on the listing. Your email is never shown." value={makerName}
              onChangeText={setMakerName} maxLength={BAZAAR_LIMITS.makerName} error={makerName ? nameError : undefined} />
          </View>
        </Step>

        <Step n={detailsOnly ? 2 : 3} title="Icon and screenshots (optional)">
          <View style={{ gap: 14, maxWidth: 640 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              {preview ? <ListingIcon listing={preview} size={56} /> : null}
              <Button label={form.iconSvg ? 'Change icon' : 'Use your own icon (SVG)'} variant="outline" icon={Shapes} onPress={chooseIcon} />
              {form.iconSvg ? <Button label="Use the app's icon" variant="ghost" onPress={() => set({ iconSvg: '' })} /> : null}
            </View>
            <Text variant="bodySmall" tone="muted">Icons are checked and cleaned. Scripts, links and pictures inside SVG files are not allowed.</Text>
            <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
              {(shots ?? []).map((s, i) => (
                <View key={i}>
                  <Image source={{ uri: `data:${s.mimeType};base64,${s.base64}` }} accessibilityLabel={`Screenshot ${i + 1}`}
                    style={{ width: Math.round((s.width / s.height) * 140), height: 140, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border }} />
                  <View style={{ position: 'absolute', top: 2, right: 2 }}>
                    <Button label="Remove" size="sm" variant="secondary" icon={X} onPress={() => { setTouched(true); setShots((shots ?? []).filter((_, j) => j !== i)); }} />
                  </View>
                </View>
              ))}
            </View>
            {(shots?.length ?? 0) < 3 ? (
              <View style={{ alignSelf: 'flex-start' }}>
                <Button label="Add screenshots" variant="outline" icon={ImagePlus} onPress={addShots} />
              </View>
            ) : null}
            <Text variant="bodySmall" tone="muted">Up to 3. Pictures are made smaller and location details are removed. Make sure they show no private entries.</Text>
            {mediaError ? <Text tone="danger" role="alert">{mediaError}</Text> : null}
          </View>
        </Step>

        <Step n={detailsOnly ? 3 : 4} title="Check what is shared">
          <View style={{ gap: 16, maxWidth: 640 }}>
            <Surface tone="alt" padded={20} style={{ gap: 8 }}>
              {app || existing ? (
                <>
                  {app ? <Line>Shared: the design of {app.spec.name}, with {app.spec.screens.length} {app.spec.screens.length === 1 ? 'screen' : 'screens'}.</Line> : null}
                  <Line>Not shared: anything saved in the app, your photos, your drawings and what you typed to create it.</Line>
                  {disclosure?.stores.length ? <Line>Listed as keeping: {disclosure.stores.join(', ').toLowerCase()}.</Line> : null}
                  {disclosure?.aiFeatures.length ? <Line>Listed AI features: {disclosure.aiFeatures.join('; ')}.</Line> : null}
                  <Line>Before it goes live, Kalam checks the design on this device and runs a safety check with Firebase cloud AI.</Line>
                </>
              ) : <Text tone="secondary">Choose an app to see what will be shared.</Text>}
            </Surface>
            {preview ? (
              <View style={{ gap: 8 }}>
                <Text variant="bodySmall" weight="medium" tone="secondary">How it will look in Kalam Bazaar</Text>
                <View pointerEvents="none"><ListingCard listing={preview} width={isPhone ? 300 : 320} /></View>
              </View>
            ) : null}
          </View>
        </Step>

        {result && !result.ok ? <Text tone="danger" role="alert">{result.message}</Text> : null}
        {touched && formErrors.length ? <Text tone="danger">{formErrors[0]}</Text> : null}

        <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 16, alignItems: isPhone ? 'stretch' : 'center' }}>
          <Button
            label={detailsOnly ? 'Save details' : existing ? `Publish version ${existing.specVersion + 1}` : 'Share in Kalam Bazaar'}
            icon={Upload}
            size="lg"
            loading={!!stage}
            disabled={!canSubmit}
            onPress={submit}
          />
          {stage ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }} role="status">
              <ActivityIndicator color={theme.colors.primary} />
              <Text tone="secondary">{STAGES[stage]}</Text>
            </View>
          ) : null}
          {!detailsOnly && selected && touched ? (
            <Button label="Discard draft" variant="ghost" onPress={async () => {
              await bazaar.removeDraft(selected);
              setTouched(false);
              setRestored(false);
              toast.show({ message: 'Draft removed.', tone: 'info' });
            }} />
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <AppShell active="bazaar">
      <Screen maxWidth={900}>
        {header}
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
  const tone = result.status === 'published' ? 'success' : result.status === 'pending_review' ? 'warning' : 'danger';
  const Icon = result.status === 'published' ? CheckCircle2 : result.status === 'pending_review' ? Clock : CircleAlert;
  const title = result.status === 'published' ? 'Shared' : result.status === 'pending_review' ? 'Saved, waiting for checks' : 'Needs changes';
  return (
    <Surface padded={24} style={{ gap: 16, maxWidth: 640 }} role="status">
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
      {result.review ? (
        <Text variant="bodySmall" tone="muted">
          {result.review.cached
            ? 'Safety check: the earlier result for the same content was used.'
            : `Safety check: ${result.review.source === 'cloud' ? 'Firebase cloud AI' : 'not run'}${result.review.model ? ` (${result.review.model})` : ''}, ${formatLatency(result.review.latencyMs)}.`}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        {result.status === 'published' && result.listingId ? (
          <Button label="View listing" onPress={() => router.push(bazaarRoutes.listing(result.listingId!))} />
        ) : null}
        {(result.status === 'rejected' || result.issues?.length) && app ? (
          <Button label="Edit the app" onPress={() => router.push(routes.editApp(app.id))} />
        ) : null}
        <Button label="Creator Studio" variant="outline" onPress={() => router.push(bazaarRoutes.mine)} />
        <Button label="Share another app" variant="ghost" onPress={onAgain} />
      </View>
    </Surface>
  );
}

function AppRow({ app, selected, blocked, onPress }: { app: StoredApp; selected: boolean; blocked?: string; onPress: () => void }) {
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
        flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, minHeight: 64, borderRadius: theme.radius.md,
        borderWidth: selected ? 2 : 1, borderColor: selected ? c.primary : c.border,
        backgroundColor: selected ? c.primarySoft : c.surface, opacity: blocked ? 0.6 : 1,
      }}
    >
      <AppIconTile icon={app.spec.icon} appColor={app.spec.theme.primary} size={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="semibold" numberOfLines={1}>{app.spec.name}</Text>
        <Text variant="bodySmall" tone="muted" numberOfLines={2}>
          {blocked ?? `${app.spec.screens.length} ${app.spec.screens.length === 1 ? 'screen' : 'screens'}`}
        </Text>
      </View>
      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: selected ? c.primary : c.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
        {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.primary }} /> : null}
      </View>
    </Pressable>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const theme = useKalamTheme();
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="bodySmall" weight="bold" tone="primary">{n}</Text>
        </View>
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
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.textMuted, marginTop: 8 }} />
      <Text style={{ flex: 1 }}>{children}</Text>
    </View>
  );
}

function Loading({ text }: { text: string }) {
  const theme = useKalamTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 24 }}>
      <ActivityIndicator color={theme.colors.primary} />
      <Text tone="secondary">{text}</Text>
    </View>
  );
}
