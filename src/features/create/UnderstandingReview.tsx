/**
 * Understanding Review (docs/03 §13, docs/02 §11.5, DIRECTION §6): a slip on the canvas that says what
 * Kalam understood, in plain language, never a JSON debugger. Every row is editable in place through the
 * pure edits in src/core/review (C2): the app's name, screens (rename, add, remove, reorder), fields (name,
 * type, required, choices), the cover, and each uncertain item (keep, change, remove). No internal ids or
 * schema paths are shown.
 */
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Undo2, X } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import type { CreationResult } from '@/core/contracts';
import type { FieldChanges, UncertainAction, UncertainItem } from '@/core/review';
import { FIELD_TYPES, type KalamFieldType } from '@/core/spec/schema';
import {
  Button, Chip, IconButton, LedgerRule, Slip, Stamp, SwitchRow, Text, TextField, useKalamTheme, type ExecutionSource,
} from '@/design';
import { useRovingFocus } from '@/design/inputs';
import type { TranslationKey } from '@/i18n/keys';
import { useT } from '@/i18n/react';

import { ClothSwatches } from './PreferencesPanel';
import { checksPassed } from './review-save';
import { routeLabelKey } from './stages';
import type { ReviewHandle } from './use-review';

export function routeSource(route: CreationResult['route']): { source: ExecutionSource; kind: 'template' | 'device' | 'cloud'; label: TranslationKey } {
  switch (route) {
    case 'template': return { source: 'deterministic', kind: 'template', label: 'source.template' };
    case 'template+on_device': return { source: 'on_device', kind: 'device', label: 'source.onDevice' };
    case 'cloud': case 'cloud+repair': return { source: 'cloud', kind: 'cloud', label: 'source.cloud' };
    case 'specialist': return { source: 'cloud', kind: 'cloud', label: 'source.specialist' };
    default: return { source: 'deterministic', kind: 'template', label: 'source.template' };
  }
}

const FIELD_TYPE_KEY: Record<KalamFieldType, TranslationKey> = {
  text: 'review.fieldType.text', number: 'review.fieldType.number', date: 'review.fieldType.date',
  enum: 'review.fieldType.enum', boolean: 'review.fieldType.boolean', image: 'review.fieldType.image',
};
const ACTION_KEY: Record<UncertainAction, TranslationKey> = { accept: 'review.action.accept', change: 'review.action.change', remove: 'review.action.remove' };
const KIND_KEY: Record<UncertainItem['kind'], TranslationKey> = { check: 'review.item.check', assumption: 'review.item.assumption', question: 'review.item.question' };
/** A photo field is added by asking for a photo in the app, so it is never a choice here (REVIEW_COPY.photoField). */
const EDITABLE_TYPES = FIELD_TYPES.filter((f) => f !== 'image');

function Section({ title, children, count }: { title: string; children: ReactNode; count?: number }) {
  const { space } = useKalamTheme();
  return (
    <View style={{ gap: space[3] }}>
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space[2] }}>
          <Text variant="h3" level={3}>{title}</Text>
          {count !== undefined ? <Text mono tone="muted" accessibilityElementsHidden importantForAccessibility="no">{String(count).padStart(2, '0')}</Text> : null}
        </View>
        <LedgerRule />
      </View>
      {children}
    </View>
  );
}

function Bullets({ items }: { items: string[] }) {
  const { colors, space } = useKalamTheme();
  return (
    <View role="list" style={{ gap: space[2] }}>
      {items.map((t, i) => (
        <View key={`${i}-${t}`} role="listitem" style={{ flexDirection: 'row', gap: space[2] }}>
          <View aria-hidden style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.textSecondary, marginTop: 10 }} />
          <Text style={{ flex: 1 }}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * A text field that changes the app when the person leaves it or presses Enter. `key` it by value so a reset
 * shows. A refused change puts the app's value back, so the box and the app never disagree (the reason is a toast).
 */
function InlineField({ label, value, onCommit, labelHidden, helper, max = 120 }: {
  label: string; value: string; onCommit: (v: string) => boolean; labelHidden?: boolean; helper?: string; max?: number;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const v = draft.trim();
    if (!v || v === value || !onCommit(v)) setDraft(value);
  };
  return (
    <TextField
      label={label}
      labelHidden={labelHidden}
      value={draft}
      maxLength={max}
      onChangeText={setDraft}
      onBlur={commit}
      onSubmitEditing={commit}
      helper={helper}
      returnKeyType="done"
    />
  );
}

function UncertainRow({ item, review }: { item: UncertainItem; review: ReviewHandle }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { colors, space, radius } = theme;
  const [answering, setAnswering] = useState(false);
  const [answer, setAnswer] = useState('');
  const act = (action: UncertainAction) => {
    if (action === 'change' && !item.change) { setAnswering(true); return; }
    review.dispatch({ type: 'resolve', item, action });
  };
  return (
    <View role="listitem" style={{ gap: space[3], padding: space[4], borderRadius: radius.paper, backgroundColor: colors.surface, borderLeftWidth: 3, borderLeftColor: colors.accent }}>
      <View style={{ gap: 2 }}>
        <Text variant="caption" tone="muted">{t(KIND_KEY[item.kind])}</Text>
        <Text>{item.message}</Text>
      </View>
      {answering ? (
        <View style={{ gap: space[2] }}>
          <TextField label={t('review.item.answerLabel')} value={answer} onChangeText={setAnswer} multiline autoFocus maxLength={500} />
          <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
            <Button
              label={t('review.item.answerSubmit')}
              size="sm"
              disabled={!answer.trim()}
              onPress={() => review.dispatch({ type: 'resolve', item, action: 'change', answer })}
            />
            <Button label={t('common.cancel')} size="sm" variant="ghost" onPress={() => setAnswering(false)} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
          {item.actions.map((a) => (
            <Button
              key={a}
              label={t(ACTION_KEY[a])}
              size="sm"
              variant={a === 'accept' ? 'secondary' : a === 'remove' ? 'ghost' : 'outline'}
              icon={a === 'remove' ? Trash2 : a === 'change' ? Pencil : undefined}
              accessibilityHint={t('review.actionFor', { action: t(ACTION_KEY[a]), message: item.message })}
              onPress={() => act(a)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

type Field = ReviewHandle['model']['collections'][number]['fields'][number];

function FieldRow({ collectionId, field, review }: { collectionId: string; field: Field; review: ReviewHandle }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { colors, space } = theme;
  const [open, setOpen] = useState(false);
  const edit = (changes: FieldChanges) => review.dispatch({ type: 'edit', edit: { kind: 'editField', collectionId, fieldId: field.id, changes } });
  const types: readonly KalamFieldType[] = field.type === 'image' ? FIELD_TYPES : EDITABLE_TYPES;
  const pickType = (ft: KalamFieldType) => { if (ft !== field.type && ft !== 'image') edit({ type: ft }); };
  const roving = useRovingFocus({
    count: types.length, orientation: 'both', current: Math.max(0, types.indexOf(field.type)),
    onMove: (i) => { const ft = types[i]; if (ft) pickType(ft); }, onActivate: (i) => { const ft = types[i]; if (ft) pickType(ft); },
  });
  return (
    <View role="listitem" style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 48, paddingLeft: space[1] }}>
        <Text style={{ flex: 1 }} weight="medium">{field.label}</Text>
        <Text variant="bodySmall" tone="muted">{t(FIELD_TYPE_KEY[field.type])}</Text>
        <Text variant="caption" tone={field.required ? 'primary' : 'muted'} style={{ minWidth: 64, textAlign: 'right' }}>
          {t(field.required ? 'review.body.required' : 'review.body.optional')}
        </Text>
        <IconButton
          icon={open ? X : Pencil}
          label={t(open ? 'review.edit.closeField' : 'review.edit.field', { name: field.label })}
          onPress={() => setOpen((o) => !o)}
          selected={open}
        />
      </View>
      {open ? (
        <View style={{ gap: space[4], paddingBottom: space[4], paddingLeft: space[1] }}>
          <InlineField key={field.label} label={t('review.edit.fieldName')} value={field.label} onCommit={(label) => edit({ label })} />
          <View role="radiogroup" aria-label={t('review.edit.fieldType', { name: field.label })} style={{ gap: space[2] }}>
            <Text variant="bodySmall" weight="semibold" tone="secondary">{t('review.edit.fieldType', { name: field.label })}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {types.map((ft, i) => (
                <Chip key={ft} role="radio" label={t(FIELD_TYPE_KEY[ft])} selected={field.type === ft} onPress={() => pickType(ft)} rovingProps={roving.itemProps(i)} />
              ))}
            </View>
          </View>
          <SwitchRow label={t('review.edit.required', { name: field.label })} value={field.required} onValueChange={(required) => edit({ required })} />
          {field.type === 'enum' ? (
            <InlineField
              key={(field.options ?? []).join('|')}
              label={t('review.edit.options', { name: field.label })}
              helper={t('review.edit.optionsHelper')}
              value={(field.options ?? []).join(', ')}
              max={3000}
              onCommit={(v) => edit({ options: v.split(',').map((o) => o.trim()).filter(Boolean) })}
            />
          ) : null}
          <View style={{ flexDirection: 'row' }}>
            <Button
              label={t('review.edit.removeField', { name: field.label })}
              icon={Trash2}
              variant="ghost"
              size="sm"
              onPress={() => review.dispatch({ type: 'edit', edit: { kind: 'removeField', collectionId, fieldId: field.id } })}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function AddScreen({ review }: { review: ReviewHandle }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const [title, setTitle] = useState('');
  const add = () => {
    const v = title.trim();
    if (!v) return;
    review.dispatch({ type: 'edit', edit: { kind: 'addScreen', title: v } });
    setTitle('');
  };
  return (
    <View style={{ gap: 6 }}>
      <Text variant="bodySmall" weight="semibold" tone="secondary">{t('review.edit.newScreen')}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <View style={{ flex: 1 }}>
          <TextField label={t('review.edit.newScreen')} labelHidden value={title} onChangeText={setTitle} onSubmitEditing={add} maxLength={60} returnKeyType="done" />
        </View>
        <Button label={t('review.edit.addScreen')} icon={Plus} variant="outline" onPress={add} disabled={!title.trim()} />
      </View>
    </View>
  );
}

export function UnderstandingReview({ result, review, builtFrom }: { result: CreationResult; review: ReviewHandle; builtFrom?: string }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { colors, space } = theme;
  const route = routeSource(result.route);
  const passed = checksPassed(result);
  const { summary, model, uncertain, state } = review;
  const fieldsCount = model.collections.reduce((n, c) => n + c.fields.length, 0);
  const itemsFor = (id: string) => summary.screens.find((s) => s.id === id)?.items ?? [];
  const last = model.screens.length - 1;

  return (
    <Slip title={t('review.understood')} tint="kraft" style={{ gap: space[8] }}>
      {/* Source stamps at the top: which engine built it, and whether every check passed or an AI step still needs one. */}
      <View style={{ gap: space[3] }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'center' }}>
          <Stamp kind={route.kind} label={t(route.label)} />
          <Stamp kind={passed ? 'checked' : 'needs'} label={t(passed ? 'stamp.checked' : 'stamp.needs')} />
        </View>
        <Text variant="bodySmall" tone="secondary">{t(routeLabelKey(result.route))}</Text>
        <Text variant="bodyLarge">{summary.purpose}</Text>
        {builtFrom ? (
          <Text variant="bodySmall" tone="secondary" testID="built-from">
            <Text variant="bodySmall" weight="semibold">{t('review.body.builtFrom')} </Text>{builtFrom}
          </Text>
        ) : null}
        <InlineField key={model.name} label={t('review.body.appName')} helper={t('review.body.appNameHelper')} value={model.name} max={60}
          onCommit={(name) => review.dispatch({ type: 'edit', edit: { kind: 'renameApp', name } })} />
      </View>

      {state.edits > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], flexWrap: 'wrap' }}>
          <Text variant="bodySmall" tone="secondary">{t('review.edit.changes', { count: state.edits })}</Text>
          <Button label={t('review.edit.reset')} icon={Undo2} variant="ghost" size="sm" onPress={() => review.dispatch({ type: 'reset' })} />
        </View>
      ) : null}

      {uncertain.length ? (
        <Section title={t('review.section.check')} count={uncertain.length}>
          <View role="list" style={{ gap: space[3] }}>
            {uncertain.map((item) => <UncertainRow key={item.id} item={item} review={review} />)}
          </View>
        </Section>
      ) : null}

      <Section title={t('review.section.screens')} count={model.screens.length}>
        <View role="list" style={{ gap: space[4] }}>
          {model.screens.map((s, i) => (
            <View key={s.id} role="listitem" style={{ gap: space[2] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1], flexWrap: 'wrap' }}>
                <Text mono variant="caption" style={{ color: colors.markInk, width: 30 }}>{String(i + 1).padStart(2, '0')}</Text>
                <View style={{ flex: 1, minWidth: 200 }}>
                  <InlineField key={s.title} label={t('review.edit.screenName', { n: i + 1 })} labelHidden value={s.title} max={60}
                    onCommit={(title) => review.dispatch({ type: 'edit', edit: { kind: 'renameScreen', screenId: s.id, title } })} />
                </View>
                {/* The move and remove keys wrap as one group: on phones they take their own line, at the end. */}
                <View style={{ flexDirection: 'row', flexShrink: 0, marginLeft: 'auto' }}>
                  <IconButton icon={ArrowUp} label={t('review.edit.moveUp', { name: s.title })} disabled={i === 0}
                    onPress={() => review.dispatch({ type: 'edit', edit: { kind: 'moveScreen', screenId: s.id, toIndex: i - 1 } })} />
                  <IconButton icon={ArrowDown} label={t('review.edit.moveDown', { name: s.title })} disabled={i === last}
                    onPress={() => review.dispatch({ type: 'edit', edit: { kind: 'moveScreen', screenId: s.id, toIndex: i + 1 } })} />
                  <IconButton icon={Trash2} label={t('review.edit.removeScreen', { name: s.title })} disabled={model.screens.length <= 1}
                    onPress={() => review.dispatch({ type: 'edit', edit: { kind: 'removeScreen', screenId: s.id } })} />
                </View>
              </View>
              <View style={{ paddingLeft: 34, gap: space[2] }}>
                {s.start ? <Stamp kind="plain" label={t('review.body.start')} size="sm" icon={null} /> : null}
                {itemsFor(s.id).length ? <Bullets items={itemsFor(s.id)} /> : <Text tone="muted">{t('review.body.emptyScreen')}</Text>}
              </View>
            </View>
          ))}
        </View>
        <AddScreen review={review} />
      </Section>

      <Section title={t('review.section.fields')} count={fieldsCount}>
        {model.collections.length === 0 ? <Text tone="muted">{t('review.body.noRecords')}</Text> : (
          <View style={{ gap: space[5] }}>
            {model.collections.map((c) => (
              <View key={c.id} style={{ gap: space[2] }}>
                <Text weight="semibold">{c.name}</Text>
                <View role="list" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  {c.fields.map((f) => <FieldRow key={f.id} collectionId={c.id} field={f} review={review} />)}
                </View>
              </View>
            ))}
          </View>
        )}
      </Section>

      <Section title={t('review.section.actions')} count={summary.actions.length}>
        {summary.actions.length ? <Bullets items={summary.actions} /> : <Text tone="muted">{t('review.body.noActions')}</Text>}
      </Section>

      <Section title={t('review.section.data')}>
        <Text>
          {model.collections.length
            ? t('review.body.dataSaved', { names: model.collections.map((c) => c.name).join(', ') })
            : t('review.body.dataNone')}
        </Text>
      </Section>

      <Section title={t('review.section.ai')} count={summary.aiFeatures.length}>
        {summary.aiFeatures.length ? (
          <View style={{ gap: space[3] }}>
            {summary.aiFeatures.map((a) => (
              <View key={a.id} style={{ gap: space[1] }}>
                <Text>{a.description}</Text>
                <Text variant="bodySmall" tone="secondary">{a.verified}</Text>
              </View>
            ))}
          </View>
        ) : <Text tone="muted">{t('review.section.noAi')}</Text>}
      </Section>

      <Section title={t('create.look.title')}>
        <View role="radiogroup" aria-label={t('create.look.title')}>
          <ClothSwatches value={model.theme} onChange={(preset) => { if (preset) review.dispatch({ type: 'edit', edit: { kind: 'setTheme', preset } }); }} />
        </View>
      </Section>
    </Slip>
  );
}
