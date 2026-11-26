import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import type { KalamSpec } from '@/core/spec/schema';
import type { MakeResult, PreviewResult, WidgetCandidate, WidgetDraft } from '@/core/widgets';
import { Button, SegmentedControl, SwitchRow, Text, TextField, useKalamTheme } from '@/design';
import { Choice } from './Choice';
import { WIDGET_UI } from './copy';
import {
  chooseCandidate, draftFromForm, formProblems, toggleField, type WidgetForm,
} from './form-model';
import { WidgetPreview } from './WidgetPreview';

export interface WidgetFormViewProps {
  spec: KalamSpec;
  candidates: readonly WidgetCandidate[];
  /** The form to start from: empty for a new widget, or the saved widget being edited. */
  initial: WidgetForm;
  editing: boolean;
  /** The system can be asked to add the widget, so saving can also add it. */
  canPin: boolean;
  preview: (draft: WidgetDraft) => Promise<PreviewResult>;
  /** Saves. `andAdd` also asks the system to put it on the home screen. Resolves with what the service said. */
  onSave: (draft: WidgetDraft, andAdd: boolean) => Promise<MakeResult>;
  onBack: () => void;
}

const ROW_CHOICES = ['1', '2', '3', '4', '5'] as const;

const kindLabel = (c: WidgetCandidate) => WIDGET_UI.form.kind[c.kind];

/** The "New widget" and "Edit widget" form. Every choice is one of a short list; the only free text is the name. */
export function WidgetFormView({ spec, candidates, initial, editing, canPin, preview, onSave, onBack }: WidgetFormViewProps) {
  const theme = useKalamTheme();
  const [form, setForm] = useState<WidgetForm>(initial);
  const [showProblems, setShowProblems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>();
  const [fetched, setFetched] = useState<{ draft: WidgetDraft; result: PreviewResult } | undefined>();

  const chosen = candidates.find((c) => c.key === form.key);
  const problems = useMemo(() => formProblems(form, candidates), [form, candidates]);
  const draft = useMemo(() => draftFromForm(spec.id, form, candidates), [spec.id, form, candidates]);

  // What the widget would show, refreshed shortly after each change. Only an answer for the draft on screen is shown.
  useEffect(() => {
    if (!draft) return;
    let alive = true;
    const timer = setTimeout(() => {
      preview(draft)
        .then((result) => alive && setFetched({ draft, result }))
        .catch(() => alive && setFetched({ draft, result: { ok: false, message: WIDGET_UI.form.previewFailed } }));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [draft, preview]);
  const shown = draft && fetched?.draft === draft ? fetched.result : undefined;

  const problemOf = (field: 'key' | 'title' | 'fields') => (showProblems ? problems.find((p) => p.field === field)?.message : undefined);
  const set = (patch: Partial<WidgetForm>) => {
    setRefusal(undefined);
    setForm((f) => ({ ...f, ...patch }));
  };

  const save = async (andAdd: boolean) => {
    if (!draft) {
      setShowProblems(true);
      return;
    }
    setBusy(true);
    setRefusal(undefined);
    try {
      const r = await onSave(draft, andAdd);
      if (!r.ok) setRefusal(r.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: theme.space[5] }}>
      <View style={{ gap: theme.space[2] }} role="radiogroup" aria-label={WIDGET_UI.form.showHeading}>
        <Text variant="h4">{WIDGET_UI.form.showHeading}</Text>
        {candidates.length === 0 ? <Text tone="secondary">{WIDGET_UI.form.showNone}</Text> : <Text variant="bodySmall" tone="secondary">{WIDGET_UI.form.showHint}</Text>}
        {candidates.map((c) => (
          <Choice
            key={c.key}
            label={c.label}
            description={c.screenTitle ? `${kindLabel(c)} on ${c.screenTitle}` : kindLabel(c)}
            selected={c.key === form.key}
            onPress={() => set(chooseCandidate(form, c))}
          />
        ))}
        {problemOf('key') ? <Text variant="bodySmall" tone="danger" role="alert">{problemOf('key')}</Text> : null}
      </View>

      {chosen ? (
        <>
          <TextField
            label={WIDGET_UI.form.nameLabel}
            helper={WIDGET_UI.form.nameHelper}
            value={form.title}
            maxLength={40}
            error={problemOf('title')}
            onChangeText={(t) => set({ title: t, titleEdited: true })}
          />

          {chosen.kind === 'list' ? (
            <>
              <SegmentedControl
                label={WIDGET_UI.form.rowsLabel}
                options={ROW_CHOICES.map((n) => ({ value: n, label: n }))}
                value={String(form.rows) as (typeof ROW_CHOICES)[number]}
                onChange={(v) => set({ rows: Number(v) })}
              />
              <View style={{ gap: theme.space[2] }} role="group" aria-label={WIDGET_UI.form.fieldsHeading}>
                <Text variant="h4">{WIDGET_UI.form.fieldsHeading}</Text>
                <Text variant="bodySmall" tone="secondary">{WIDGET_UI.form.fieldsHint}</Text>
                {chosen.fields.map((f) => (
                  <Choice
                    key={f.id}
                    kind="checkbox"
                    label={f.isCheck ? WIDGET_UI.form.fieldCheck(f.label) : f.label}
                    selected={form.fields.includes(f.id)}
                    onPress={() => set(toggleField(form, chosen, f.id))}
                  />
                ))}
                {problemOf('fields') ? <Text variant="bodySmall" tone="danger" role="alert">{problemOf('fields')}</Text> : null}
              </View>
            </>
          ) : null}

          <SegmentedControl
            label={WIDGET_UI.form.sizeLabel}
            options={[{ value: 'small', label: WIDGET_UI.form.size.small }, { value: 'medium', label: WIDGET_UI.form.size.medium }]}
            value={form.size}
            onChange={(size) => set({ size })}
          />
          <SegmentedControl
            label={WIDGET_UI.form.refreshLabel}
            options={[{ value: 'live', label: WIDGET_UI.form.refresh.live }, { value: 'on_open', label: WIDGET_UI.form.refresh.on_open }]}
            value={form.refresh}
            onChange={(refresh) => set({ refresh })}
            wrap
          />
          <SwitchRow
            label={WIDGET_UI.form.lockLabel}
            description={form.hideWhenLocked ? WIDGET_UI.form.lockHelp.on : WIDGET_UI.form.lockHelp.off}
            value={form.hideWhenLocked}
            onValueChange={(hideWhenLocked) => set({ hideWhenLocked })}
          />

          <View style={{ gap: theme.space[2] }} role="radiogroup" aria-label={WIDGET_UI.form.tapHeading}>
            <Text variant="h4">{WIDGET_UI.form.tapHeading}</Text>
            <Choice label={WIDGET_UI.form.tapOpenApp} selected={form.tapScreen === undefined} onPress={() => set({ tapScreen: undefined })} />
            {spec.screens.map((s) => (
              <Choice key={s.id} label={WIDGET_UI.form.tapOpenScreen(s.title)} selected={form.tapScreen === s.id} onPress={() => set({ tapScreen: s.id })} />
            ))}
          </View>

          <View style={{ gap: theme.space[2] }}>
            <Text variant="h4">{WIDGET_UI.form.previewHeading}</Text>
            {shown?.ok ? (
              <WidgetPreview appName={shown.appName} title={form.title.trim()} body={shown.body} />
            ) : (
              <Text tone="secondary">{shown ? shown.message : ' '}</Text>
            )}
          </View>
        </>
      ) : null}

      {refusal ? <Text tone="danger" role="alert">{refusal}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        <Button label={WIDGET_UI.form.back} variant="ghost" onPress={onBack} disabled={busy} />
        {canPin && !editing ? (
          <>
            <Button label={WIDGET_UI.form.save} variant="secondary" loading={busy} onPress={() => void save(false)} />
            <Button label={WIDGET_UI.form.saveAndAdd} loading={busy} onPress={() => void save(true)} />
          </>
        ) : (
          <Button label={WIDGET_UI.form.save} loading={busy} onPress={() => void save(false)} />
        )}
      </View>
    </View>
  );
}
