import { ArrowLeft, Link2 } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { View } from 'react-native';

import { collectionLabel, fieldLabel, fieldOf, type CreateResult } from '@/core/share';
import type { KalamSpec } from '@/core/spec/schema';
import { Button, SegmentedControl, Surface, SwitchRow, Text, useKalamTheme } from '@/design';
import { ChoiceRow } from './ChoiceRow';
import { SHARE_UI } from './copy';
import {
  checkDraft, collectionsOf, emptyDraft, SHARE_INTENTS, sidesOf, targetChoices, withCollection, withIntent, withOtherApp, withTarget,
  type Draft, type OtherApp,
} from './model';

export interface NewLinkFormProps {
  /** The app the person is in. */
  spec: KalamSpec;
  others: readonly OtherApp[];
  /** Makes the link. Called only when the person presses Allow sharing. */
  onCreate: (draft: Draft) => Promise<CreateResult>;
  /** The link was made. */
  onDone: (message: string) => void;
  onBack: () => void;
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  const theme = useKalamTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text weight="semibold">{label}</Text>
      {children}
    </View>
  );
}

/**
 * Makes one link in four short steps on one screen: what to do, with which app, which lists, which fields.
 * Nothing is saved until the person has read what the link allows and pressed Allow sharing.
 */
export function NewLinkForm({ spec, others, onCreate, onDone, onBack }: NewLinkFormProps) {
  const theme = useKalamTheme();
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const other = others.find((o) => o.id === draft.otherAppId);
  const sides = sidesOf(draft, spec, other?.spec);
  const { from, to } = collectionsOf(draft, sides);
  const parentOf = (id: string) => (id === spec.id ? spec : others.find((o) => o.id === id)?.spec);
  const check = checkDraft(draft, spec, other?.spec, parentOf);
  const edit = (next: Draft) => {
    setError(undefined);
    setDraft(next);
  };

  const sourceFields = from ? Object.keys(from.fields).filter((f) => to && targetChoices(from, to, f, draft.mapping).length) : [];

  const submit = async () => {
    if (busy || check.blockers.length) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await onCreate(draft);
      if (result.ok) onDone(result.message);
      else setError([result.message, ...(result.problems ?? []).map((p) => p.message)].join(' '));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: theme.space[6], paddingBottom: theme.space[6] }} testID="share-new-link">
      <Group label={SHARE_UI.form.intentLabel}>
        <View role="radiogroup" aria-label={SHARE_UI.form.intentLabel} style={{ gap: theme.space[2] }}>
          {SHARE_INTENTS.map((intent) => (
            <ChoiceRow
              key={intent}
              label={SHARE_UI.intent[intent].label}
              description={SHARE_UI.intent[intent].description}
              selected={draft.intent === intent}
              onPress={() => edit(withIntent(intent))}
            />
          ))}
        </View>
      </Group>

      <Group label={SHARE_UI.form.appLabel}>
        {others.length ? (
          <View role="radiogroup" aria-label={SHARE_UI.form.appLabel} style={{ gap: theme.space[2] }}>
            {others.map((o) => (
              <ChoiceRow key={o.id} label={o.spec.name} selected={draft.otherAppId === o.id} onPress={() => edit(withOtherApp(draft, spec, o))} />
            ))}
          </View>
        ) : (
          <Text tone="secondary">{SHARE_UI.form.noOtherApp}</Text>
        )}
      </Group>

      {other && sides.source && sides.destination ? (
        <View style={{ gap: theme.space[4] }}>
          {([['source', sides.source], ['destination', sides.destination]] as const).map(([side, s]) => {
            const ids = Object.keys(s.collections);
            const label = side === 'source' ? SHARE_UI.form.sourceList(s.name) : SHARE_UI.form.destinationList(s.name);
            return ids.length ? (
              <SegmentedControl
                key={side}
                label={label}
                wrap
                value={(side === 'source' ? draft.sourceCollection : draft.destinationCollection) ?? ''}
                options={ids.map((id) => ({ value: id, label: collectionLabel(s, id) }))}
                onChange={(id) => edit(withCollection(draft, side, id, sides))}
              />
            ) : (
              <Text key={side} tone="secondary">{SHARE_UI.form.noLists}</Text>
            );
          })}
        </View>
      ) : null}

      {from && to ? (
        <Group label={SHARE_UI.form.fieldsHeading}>
          <Text variant="bodySmall" tone="secondary">{SHARE_UI.form.fieldsHelp}</Text>
          {sourceFields.length ? (
            sourceFields.map((fieldId) => (
              <SegmentedControl
                key={fieldId}
                label={SHARE_UI.form.fieldGroup(fieldLabel(from, fieldId))}
                wrap
                value={draft.mapping[fieldId] ?? ''}
                options={[
                  { value: '', label: SHARE_UI.form.notShared },
                  ...targetChoices(from, to, fieldId, draft.mapping).map((t) => ({ value: t, label: fieldOf(to, t)?.label ?? t })),
                ]}
                onChange={(t) => edit(withTarget(draft, fieldId, t))}
              />
            ))
          ) : (
            <Text tone="secondary">{SHARE_UI.form.noFields}</Text>
          )}
        </Group>
      ) : null}

      {check.lines.length ? (
        <Surface tone="alt" padded={theme.space[4]} style={{ gap: theme.space[2] }} testID="share-preview">
          <Text weight="semibold">{SHARE_UI.form.previewHeading}</Text>
          {check.lines.map((line) => <Text key={line} variant="bodySmall">{line}</Text>)}
        </Surface>
      ) : null}

      {check.needsBazaarAck && sides.destination ? (
        <SwitchRow
          label={SHARE_UI.form.bazaarSwitch(sides.destination.name)}
          description={SHARE_UI.form.bazaarHelp(sides.destination.name)}
          value={draft.acknowledgeBazaar}
          onValueChange={(on) => edit({ ...draft, acknowledgeBazaar: on })}
        />
      ) : null}

      <View accessibilityLiveRegion="polite" style={{ gap: theme.space[1] }}>
        {error ? <Text tone="danger">{error}</Text> : null}
        {!error && check.blockers.length ? <Text variant="bodySmall" tone="secondary">{check.blockers[0]}</Text> : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        <Button label={SHARE_UI.form.allow} icon={Link2} onPress={submit} loading={busy} disabled={check.blockers.length > 0} />
        <Button label={SHARE_UI.form.back} icon={ArrowLeft} variant="outline" onPress={onBack} disabled={busy} />
      </View>
    </View>
  );
}
