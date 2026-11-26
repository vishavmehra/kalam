import { Copy } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  CLONE_COPY, CLONE_MODES, DEFAULT_CLONE_MODE, countCopyableEntries, countPictures, defaultCloneName, type CloneMode,
} from '@/core/clone';
import type { StoredApp } from '@/core/contracts';
import { Button, ConfirmSheet, Sheet, Surface, Text, TextField, useKalamTheme } from '@/design';
import { getDatabase } from '@/infrastructure/storage/database';
import { useAppsStore } from '@/state/apps-store';

import { copy } from './copy';
import { useLast } from './use-last';
import { useCloneApp } from './use-template-actions';

export interface CloneSheetProps {
  /** The app to copy. Null keeps the sheet closed. */
  app: StoredApp | null;
  onClose: () => void;
  /** The copy is saved. The caller usually opens it or shows the shelf. */
  onCloned: (copy: StoredApp) => void;
}

function ModeRow({ mode, checked, disabled, detail, onSelect }: {
  mode: CloneMode; checked: boolean; disabled?: boolean; detail?: string; onSelect: (m: CloneMode) => void;
}) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const text = CLONE_COPY.modes[mode];
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={text.label}
      accessibilityHint={[text.description, detail].filter(Boolean).join(' ')}
      disabled={disabled}
      onPress={() => onSelect(mode)}
      style={{ minHeight: theme.touchTarget, opacity: disabled ? 0.55 : 1 }}
    >
      <Surface
        tone={checked ? 'primarySoft' : 'surface'} padded={14} bordered
        style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', borderColor: checked ? c.primary : c.border, borderWidth: checked ? 2 : 1 }}
      >
        <View
          aria-hidden
          style={{
            width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: checked ? c.primary : c.borderStrong,
            alignItems: 'center', justifyContent: 'center', marginTop: 2,
          }}
        >
          {checked ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.primary }} /> : null}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="semibold">{text.label}</Text>
          <Text variant="bodySmall" tone="secondary">{text.description}</Text>
          {detail ? <Text variant="bodySmall" tone="muted">{detail}</Text> : null}
        </View>
      </Surface>
    </Pressable>
  );
}

/**
 * Makes a separate copy of an app (docs/14 §19): a new name, then what to copy. Design only is the default. Copying
 * the saved entries asks one more question first, and says how many pictures stay behind.
 */
export function CloneSheet({ app, onClose, onCloned }: CloneSheetProps) {
  const lastApp = useLast(app);
  const shelf = useAppsStore((s) => s.apps);
  const { clone, busy } = useCloneApp();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<CloneMode>(DEFAULT_CLONE_MODE);
  const [entries, setEntries] = useState(0);
  const [pictures, setPictures] = useState(0);
  const [asking, setAsking] = useState(false);

  const names = useMemo(() => shelf.map((a) => a.spec.name), [shelf]);
  // Each app opens with a fresh name and the default choice (state reset while rendering, not in an effect).
  const [shown, setShown] = useState<string | null>(null);
  if ((app?.id ?? null) !== shown) {
    setShown(app?.id ?? null);
    if (app) {
      setName(defaultCloneName(app.spec.name, names));
      setMode(DEFAULT_CLONE_MODE);
      setAsking(false);
      setEntries(0);
      setPictures(0);
    }
  }
  useEffect(() => {
    if (!app) return;
    let live = true;
    getDatabase().records.listAll(app.id).then(
      (all) => {
        if (!live) return;
        const rows = Object.values(all).flat();
        setEntries(countCopyableEntries(app.spec, rows)); // only lists the design still has, as the copy does
        setPictures(countPictures(app.spec, rows));
      },
      () => { if (live) { setEntries(0); setPictures(0); } },
    );
    return () => { live = false; };
    // Counted once when the sheet opens for this app, not again as the shelf changes under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app?.id]);

  const trimmed = name.trim();
  const nameProblem = trimmed.length === 0 || trimmed.length > 60 ? CLONE_COPY.errors.name : undefined;

  const run = async (confirmedRecords: boolean) => {
    if (!app || nameProblem) return;
    const made = await clone(app, { name: trimmed, mode, confirmedRecords });
    setAsking(false);
    if (made) onCloned(made); // the hook has already said so, with anything that stayed behind
  };

  return (
    <>
      <Sheet
        visible={!!app && !asking}
        onClose={onClose}
        dismissible={!busy}
        title={CLONE_COPY.title}
        description={CLONE_COPY.intro}
        maxWidth={560}
        footer={
          <>
            <Button label={copy.clone.cancel} variant="ghost" size="md" onPress={onClose} disabled={busy} />
            <Button
              label={busy ? CLONE_COPY.working : CLONE_COPY.action}
              icon={Copy}
              size="md"
              loading={busy}
              disabled={!!nameProblem}
              onPress={() => (mode === 'with_records' ? setAsking(true) : void run(false))}
            />
          </>
        }
      >
        <View style={{ gap: 18, paddingBottom: 8 }}>
          <TextField
            label={CLONE_COPY.nameLabel}
            helper={CLONE_COPY.nameHint}
            error={name.length > 0 && nameProblem ? nameProblem : undefined}
            value={name}
            onChangeText={setName}
            maxLength={70}
            autoCapitalize="words"
            returnKeyType="done"
          />
          <View role="radiogroup" aria-label={CLONE_COPY.chooseLabel} style={{ gap: 10 }}>
            <Text variant="bodySmall" weight="medium" tone="secondary">{CLONE_COPY.chooseLabel}</Text>
            {CLONE_MODES.map((m) => (
              <ModeRow
                key={m}
                mode={m}
                checked={mode === m}
                disabled={m === 'with_records' && entries === 0}
                detail={m === 'with_records' ? (entries === 0 ? CLONE_COPY.noEntries : CLONE_COPY.entriesCount(entries)) : undefined}
                onSelect={setMode}
              />
            ))}
          </View>
        </View>
      </Sheet>

      <ConfirmSheet
        visible={!!app && asking}
        title={CLONE_COPY.confirmEntries.title(entries)}
        message={[CLONE_COPY.confirmEntries.message(lastApp?.spec.name ?? ''), pictures > 0 ? CLONE_COPY.confirmEntries.pictures(pictures) : '']
          .filter(Boolean).join(' ')}
        confirmLabel={CLONE_COPY.confirmEntries.confirm}
        cancelLabel={CLONE_COPY.confirmEntries.cancel}
        onConfirm={() => run(true)}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
